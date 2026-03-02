package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

const port = "3000"

var (
	nodesDir    string
	serversFile string
	sshFile     string
	staticDir   string
)

func init() {
	ex, _ := os.Executable()
	dir := filepath.Dir(ex)
	if strings.Contains(dir, "go-build") {
		dir, _ = os.Getwd()
		// go run se ejecuta desde go-server/, subir un nivel al node-builder/
		dir = filepath.Join(dir, "..")
	}
	dir, _ = filepath.Abs(dir)
	staticDir = dir
	nodesDir = filepath.Join(dir, "nodes")
	serversFile = filepath.Join(dir, "servers.json")
	sshFile = filepath.Join(dir, "ssh-connections.json")
}

// ── JSON helpers ──
func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func loadJSON(file string) []map[string]any {
	data, err := os.ReadFile(file)
	if err != nil {
		return []map[string]any{}
	}
	var result []map[string]any
	json.Unmarshal(data, &result)
	return result
}

func saveJSON(file string, data []map[string]any) error {
	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(file, b, 0644)
}

func upsert(slice []map[string]any, item map[string]any, key string) []map[string]any {
	for i, s := range slice {
		if s[key] == item[key] {
			slice[i] = item
			return slice
		}
	}
	return append(slice, item)
}

func removeByID(slice []map[string]any, id string) []map[string]any {
	result := []map[string]any{}
	for _, s := range slice {
		if s["id"] != id {
			result = append(result, s)
		}
	}
	return result
}

// ── Static files ──
func serveStatic(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	if p == "/" {
		p = "/index.html"
	}
	fp := filepath.Join(staticDir, filepath.Clean(p))
	http.ServeFile(w, r, fp)
}

// ── Nodes ──
func handleNodesCustom(w http.ResponseWriter, r *http.Request) {
	entries, err := os.ReadDir(nodesDir)
	if err != nil {
		writeJSON(w, 200, []string{})
		return
	}
	var nodes []string
	for _, e := range entries {
		if e.IsDir() {
			nodes = append(nodes, e.Name())
		}
	}
	writeJSON(w, 200, nodes)
}

func handleNodeGet(w http.ResponseWriter, r *http.Request, name string) {
	fp := filepath.Join(nodesDir, name, name+".node.ts")
	content, err := os.ReadFile(fp)
	if err != nil {
		writeJSON(w, 404, map[string]any{"error": "Not found"})
		return
	}
	writeJSON(w, 200, parseNode(string(content)))
}

func handleNodeSave(w http.ResponseWriter, r *http.Request) {
	var body struct {
		NodeData map[string]any `json:"nodeData"`
		Code     string         `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	name, _ := body.NodeData["name"].(string)
	dir := filepath.Join(nodesDir, name)
	os.MkdirAll(dir, 0755)
	os.WriteFile(filepath.Join(dir, name+".node.ts"), []byte(body.Code), 0644)

	meta := map[string]any{
		"node":        "n8n-nodes-" + strings.ToLower(name),
		"nodeVersion": "1.0",
		"codexVersion": "1.0",
		"categories":  []string{"Development"},
		"resources":   map[string]any{"primaryDocumentation": []map[string]any{{"url": ""}}},
	}
	b, _ := json.MarshalIndent(meta, "", "\t")
	os.WriteFile(filepath.Join(dir, name+".node.json"), b, 0644)
	writeJSON(w, 200, map[string]any{"success": true})
}

func parseNode(content string) map[string]any {
	get := func(pattern string) string {
		re := regexp.MustCompile(pattern)
		m := re.FindStringSubmatch(content)
		if len(m) > 1 {
			return m[1]
		}
		return ""
	}
	return map[string]any{
		"displayName": get(`displayName:\s*['"]([^'"]+)['"]`),
		"name":        get(`name:\s*['"]([^'"]+)['"]`),
		"description": get(`description:\s*['"]([^'"]+)['"]`),
		"category":    "input",
		"properties":  []any{},
		"operations":  []any{},
	}
}

// ── Servers ──
func handleServerTest(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	host, _ := body["host"].(string)
	if host == "" {
		writeJSON(w, 200, map[string]any{"success": false, "error": "Host requerido"})
		return
	}
	if !strings.HasPrefix(host, "http") {
		host = "https://" + host
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", host, nil)
	_, err := http.DefaultClient.Do(req)
	if err != nil {
		writeJSON(w, 200, map[string]any{"success": false, "error": "No se pudo conectar: " + err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"success": true})
}

// ── Deploy ──
func handleDeploy(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Nodes    []string `json:"nodes"`
		ServerID string   `json:"serverId"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	servers := loadJSON(serversFile)
	var srv map[string]any
	for _, s := range servers {
		if s["id"] == body.ServerID {
			srv = s
			break
		}
	}
	if srv == nil {
		writeJSON(w, 404, map[string]any{"error": "Servidor no encontrado"})
		return
	}

	var output strings.Builder
	isRemote, _ := srv["isRemote"].(bool)
	srvPath, _ := srv["path"].(string)

	if isRemote {
		sshUser, _ := srv["sshUser"].(string)
		sshHost, _ := srv["host"].(string)
		sshPort, _ := srv["sshPort"].(string)
		if sshPort == "" {
			sshPort = "22"
		}
		for _, name := range body.Nodes {
			src := filepath.Join(nodesDir, name)
			cmd := exec.Command("scp", "-r", "-P", sshPort, src, sshUser+"@"+sshHost+":"+srvPath+"/nodes/")
			out, err := cmd.CombinedOutput()
			output.Write(out)
			if err != nil {
				writeJSON(w, 200, map[string]any{"success": false, "error": err.Error(), "output": output.String()})
				return
			}
			output.WriteString("✓ Copiado: " + name + "\n")
		}
		output.WriteString("\nEjecutando npm run build...\n")
		cmd := exec.Command("ssh", "-p", sshPort, sshUser+"@"+sshHost, "cd "+srvPath+" && npm run build")
		out, err := cmd.CombinedOutput()
		output.Write(out)
		if err != nil {
			writeJSON(w, 200, map[string]any{"success": false, "error": err.Error(), "output": output.String()})
			return
		}
	} else {
		for _, name := range body.Nodes {
			src := filepath.Join(nodesDir, name)
			dst := filepath.Join(srvPath, "nodes", name)
			if src != dst {
				if err := copyDir(src, dst); err != nil {
					writeJSON(w, 200, map[string]any{"success": false, "error": err.Error(), "output": output.String()})
					return
				}
			}
			output.WriteString("✓ Copiado: " + name + "\n")
		}
		output.WriteString("\nEjecutando npm run build...\n")
		cmd := exec.Command("npm", "run", "build")
		cmd.Dir = srvPath
		out, err := cmd.CombinedOutput()
		output.Write(out)
		if err != nil {
			writeJSON(w, 200, map[string]any{"success": false, "error": err.Error(), "output": output.String()})
			return
		}
	}
	writeJSON(w, 200, map[string]any{"success": true, "output": output.String()})
}

func copyDir(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, path)
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, info.Mode())
		}
		return copyFile(path, target)
	})
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

// ── WebSocket SSH Terminal ──
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type wsMsg struct {
	Type     string `json:"type"`
	Data     string `json:"data,omitempty"`
	Host     string `json:"host,omitempty"`
	Port     string `json:"port,omitempty"`
	User     string `json:"user,omitempty"`
	Password string `json:"password,omitempty"`
	Cols     uint16 `json:"cols,omitempty"`
	Rows     uint16 `json:"rows,omitempty"`
}

func handleSSHTerminal(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	var ptmx *os.File
	var sshCmd *exec.Cmd

	defer func() {
		if ptmx != nil {
			ptmx.Close()
		}
		if sshCmd != nil && sshCmd.Process != nil {
			sshCmd.Process.Kill()
		}
	}()

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var msg wsMsg
		json.Unmarshal(raw, &msg)

		switch msg.Type {
		case "connect":
			sshPort := msg.Port
			if sshPort == "" {
				sshPort = "22"
			}
			cols, rows := msg.Cols, msg.Rows
			if cols == 0 { cols = 120 }
			if rows == 0 { rows = 30 }

			sshArgs := []string{"-tt", "-p", sshPort, "-o", "StrictHostKeyChecking=no", msg.User + "@" + msg.Host}
			if msg.Password != "" {
				sshCmd = exec.Command("sshpass", append([]string{"-p", msg.Password, "ssh"}, sshArgs...)...)
			} else {
				sshCmd = exec.Command("ssh", sshArgs...)
			}

			ptmx, err = pty.StartWithSize(sshCmd, &pty.Winsize{Cols: cols, Rows: rows})
			if err != nil {
				send(conn, wsMsg{Type: "error", Data: err.Error()})
				continue
			}

			go func(p *os.File) {
				buf := make([]byte, 4096)
				for {
					n, err := p.Read(buf)
					if err != nil {
						send(conn, wsMsg{Type: "close"})
						return
					}
					send(conn, wsMsg{Type: "output", Data: string(buf[:n])})
				}
			}(ptmx)

		case "input":
			if ptmx != nil {
				ptmx.Write([]byte(msg.Data))
			}

		case "resize":
			if ptmx != nil {
				pty.Setsize(ptmx, &pty.Winsize{Cols: msg.Cols, Rows: msg.Rows})
			}
		}
	}
}

func send(conn *websocket.Conn, msg wsMsg) {
	b, _ := json.Marshal(msg)
	conn.WriteMessage(websocket.TextMessage, b)
}

// ── Router ──
func main() {
	mux := http.NewServeMux()

	// Static
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/ssh/terminal" {
			http.NotFound(w, r)
			return
		}
		serveStatic(w, r)
	})

	// WebSocket
	mux.HandleFunc("/ssh/terminal", handleSSHTerminal)

	// Official nodes meta (properties)
	mux.HandleFunc("/api/nodes/official/", func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/api/nodes/official/")
		metaFile := filepath.Join(staticDir, "core-nodes-meta.json")
		data, err := os.ReadFile(metaFile)
		if err != nil {
			writeJSON(w, 404, map[string]any{"error": "meta not found"})
			return
		}
		var all map[string]json.RawMessage
		json.Unmarshal(data, &all)
		node, ok := all[name]
		if !ok {
			writeJSON(w, 404, map[string]any{"error": "node not found"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(node)
	})

	// Nodes
	mux.HandleFunc("/api/nodes/custom", func(w http.ResponseWriter, r *http.Request) {
		handleNodesCustom(w, r)
	})
	mux.HandleFunc("/api/nodes/save", func(w http.ResponseWriter, r *http.Request) {
		handleNodeSave(w, r)
	})
	mux.HandleFunc("/api/nodes/delete/", func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/api/nodes/delete/")
		os.RemoveAll(filepath.Join(nodesDir, name))
		writeJSON(w, 200, map[string]any{"success": true})
	})
	mux.HandleFunc("/api/nodes/", func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/api/nodes/")
		handleNodeGet(w, r, name)
	})

	// Servers
	mux.HandleFunc("/api/servers/test", func(w http.ResponseWriter, r *http.Request) {
		handleServerTest(w, r)
	})
	mux.HandleFunc("/api/servers/save", func(w http.ResponseWriter, r *http.Request) {
		var srv map[string]any
		json.NewDecoder(r.Body).Decode(&srv)
		servers := upsert(loadJSON(serversFile), srv, "id")
		saveJSON(serversFile, servers)
		writeJSON(w, 200, map[string]any{"success": true})
	})
	mux.HandleFunc("/api/servers/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/api/servers/")
		if r.Method == "DELETE" {
			saveJSON(serversFile, removeByID(loadJSON(serversFile), id))
			writeJSON(w, 200, map[string]any{"success": true})
			return
		}
		writeJSON(w, 200, loadJSON(serversFile))
	})
	mux.HandleFunc("/api/servers", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, loadJSON(serversFile))
	})

	// SSH connections
	mux.HandleFunc("/api/ssh/connections", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, loadJSON(sshFile))
	})
	mux.HandleFunc("/api/ssh/save", func(w http.ResponseWriter, r *http.Request) {
		var conn map[string]any
		json.NewDecoder(r.Body).Decode(&conn)
		conns := upsert(loadJSON(sshFile), conn, "id")
		saveJSON(sshFile, conns)
		writeJSON(w, 200, map[string]any{"success": true})
	})
	mux.HandleFunc("/api/ssh/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/api/ssh/")
		if r.Method == "DELETE" {
			saveJSON(sshFile, removeByID(loadJSON(sshFile), id))
			writeJSON(w, 200, map[string]any{"success": true})
		}
	})

	// Deploy
	mux.HandleFunc("/api/deploy", func(w http.ResponseWriter, r *http.Request) {
		handleDeploy(w, r)
	})

	fmt.Printf("\n🚀 n8n Node Builder → http://localhost:%s\n\n", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
