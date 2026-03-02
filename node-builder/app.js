// ── Datos ──
const CORE_NODES = [
    { name: 'HttpRequest', category: 'input' },
    { name: 'Set', category: 'transform' },
    { name: 'Code', category: 'transform' },
    { name: 'If', category: 'flow' },
    { name: 'Switch', category: 'flow' },
    { name: 'Merge', category: 'flow' },
    { name: 'Filter', category: 'transform' },
    { name: 'SplitInBatches', category: 'flow' },
    { name: 'Wait', category: 'flow' },
    { name: 'ItemLists', category: 'transform' },
    { name: 'Aggregate', category: 'transform' },
    { name: 'DateTime', category: 'transform' },
    { name: 'HtmlExtract', category: 'transform' },
    { name: 'Crypto', category: 'transform' },
    { name: 'Compression', category: 'transform' },
];

const state = {
    properties: [],
    operations: [],
    selectedCoreNode: null,
    servers: [],
    editingServerId: null,
    customNodes: [],
};

// ── Init ──
// ── Theme ──
function toggleTheme(dark) {
    document.body.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
}

document.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') {
        document.body.classList.add('dark');
        document.getElementById('theme-switch').checked = true;
    }
    setupNav();
    renderCoreNodes();
    loadCustomNodes();
    loadServers();
    loadSshConnections();
    setupEditorListeners();
    setupServerListeners();
});

// ── Navegación ──
function setupNav() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const section = btn.dataset.section;
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
            document.getElementById(`section-${section}`).classList.remove('hidden');
            document.getElementById('nodes-panel').style.display = section === 'editor' ? 'flex' : 'none';
            if (section === 'deploy') refreshDeploySection();
        });
    });
    document.getElementById('nodes-panel').style.display = 'flex';
}

// ── Editor: nodos ──
function renderCoreNodes(filter = '') {
    const list = document.getElementById('core-nodes-list');
    list.innerHTML = '';
    CORE_NODES.filter(n => n.name.toLowerCase().includes(filter.toLowerCase())).forEach(node => {
        const li = document.createElement('li');
        li.textContent = node.name;
        li.addEventListener('click', () => openCoreModal(node.name));
        list.appendChild(li);
    });
}

function loadCustomNodes() {
    fetch('/api/nodes/custom')
        .then(r => r.json())
        .then(nodes => { state.customNodes = nodes; renderCustomNodes(nodes); })
        .catch(() => { state.customNodes = ['Example', 'GithubIssues']; renderCustomNodes(state.customNodes); });
}

function renderCustomNodes(nodes, filter = '') {
    const list = document.getElementById('custom-nodes-list');
    list.innerHTML = '';
    nodes.filter(n => n.toLowerCase().includes(filter.toLowerCase())).forEach(name => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="node-name">${name}</span><button class="btn-node-delete" onclick="deleteCustomNode(event,'${name}')" title="Eliminar"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>`;
        li.querySelector('.node-name').addEventListener('click', () => loadCustomNode(name));
        list.appendChild(li);
    });
}

// ── Confirm modal ──
let _confirmResolve = null;
function showConfirm(message, title = 'Confirmar') {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-modal').classList.remove('hidden');
    return new Promise(res => { _confirmResolve = res; });
}
function confirmResolve(val) {
    document.getElementById('confirm-modal').classList.add('hidden');
    if (_confirmResolve) { _confirmResolve(val); _confirmResolve = null; }
}
window.confirmResolve = confirmResolve;

function deleteCustomNode(e, name) {
    e.stopPropagation();
    showConfirm(`¿Eliminás el nodo "${name}"? Esta acción no se puede deshacer.`, 'Eliminar nodo')
        .then(ok => { if (ok) fetch(`/api/nodes/delete/${name}`, { method: 'POST' }).then(() => loadCustomNodes()); });
}

function setupEditorListeners() {
    document.getElementById('json-import-input').addEventListener('input', () => {
        const raw = document.getElementById('json-import-input').value.trim();
        if (!raw) return;
        try { JSON.parse(raw); applyNodeJson(); } catch { /* JSON incompleto, esperar */ }
    });
    document.getElementById('search-input').addEventListener('input', e => {
        renderCoreNodes(e.target.value);
        renderCustomNodes(state.customNodes, e.target.value);
    });
    document.getElementById('has-auth').addEventListener('change', e => {
        document.getElementById('auth-container').classList.toggle('hidden', !e.target.checked);
    });
    document.getElementById('has-operations').addEventListener('change', e => {
        document.getElementById('operations-container').classList.toggle('hidden', !e.target.checked);
    });
    document.getElementById('displayName').addEventListener('input', e => {
        const name = e.target.value.toLowerCase().replace(/\s+(.)/g, (_, c) => c.toUpperCase()).replace(/[^a-z0-9]/gi, '');
        document.getElementById('name').value = name;
        document.getElementById('editor-title').textContent = e.target.value || 'Sin título';
        generateCode();
    });
    ['name', 'description', 'category', 'baseUrl', 'auth-type'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.addEventListener('input', generateCode); el.addEventListener('change', generateCode); }
    });
}

// ── Core node: vista read-only con properties reales ──
function openCoreModal(name) {
    state.selectedCoreNode = name;
    state.properties = []; state.operations = [];
    clearForm();

    document.getElementById('node-editor').classList.add('editor-readonly');
    document.getElementById('core-banner').classList.remove('hidden');
    document.getElementById('core-banner-name').textContent = name;
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('node-editor').classList.remove('hidden');
    document.querySelector('.code-panel-header span').textContent = 'TypeScript generado';
    const badge = document.getElementById('editor-badge');
    badge.textContent = 'Core n8n'; badge.className = 'badge';

    document.querySelectorAll('#core-nodes-list li').forEach(li =>
        li.classList.toggle('active', li.textContent === name));

    fetch(`/api/nodes/official/${name}`)
        .then(r => r.json())
        .then(data => {
            document.getElementById('displayName').value = data.displayName || name;
            document.getElementById('name').value = data.name || name.toLowerCase();
            document.getElementById('description').value = data.description || '';
            document.getElementById('category').value = (data.group || ['input'])[0];
            document.getElementById('editor-title').textContent = data.displayName || name;
            // Mostrar properties como cards read-only
            document.getElementById('properties-list').innerHTML = '';
            state.properties = [];
            (data.properties || []).forEach(p => addCoreProperty(p));
            generateCode();
        })
        .catch(() => {
            document.getElementById('displayName').value = name;
            document.getElementById('editor-title').textContent = name;
        });
}

function addCoreProperty(p) {
    const div = document.createElement('div');
    div.className = 'prop-card';
    const def = typeof p.default === 'object' ? JSON.stringify(p.default) : String(p.default ?? '');
    const desc = typeof p.description === 'string' ? p.description.replace(/<[^>]*>/g, '') : '';
    const optionsHtml = p.options ? `<div class="form-group"><label>Opciones</label><input type="text" value="${escHtml((Array.isArray(p.options)?p.options:[]).map(o=>o.value||o).join(', '))}" readonly></div>` : '';
    div.innerHTML = `
        <div class="card-header"><span>${escHtml(p.displayName || p.name)}</span><span class="prop-type-badge">${escHtml(p.type)}</span></div>
        <div class="form-row">
            <div class="form-group"><label>Nombre interno</label><input type="text" value="${escHtml(p.name)}" readonly></div>
            <div class="form-group"><label>Default</label><input type="text" value="${escHtml(def)}" readonly></div>
        </div>
        ${desc ? `<div class="form-group"><label>Descripción</label><input type="text" value="${escHtml(desc)}" readonly></div>` : ''}
        ${optionsHtml}`;
    document.getElementById('properties-list').appendChild(div);
}

function useAsBase() {
    const name = state.selectedCoreNode;
    state.properties = []; state.operations = [];
    clearForm();

    document.getElementById('node-editor').classList.remove('editor-readonly');
    document.getElementById('core-banner').classList.add('hidden');
    document.querySelector('.code-panel-header span').textContent = 'TypeScript generado';
    const badge = document.getElementById('editor-badge');
    badge.textContent = 'Nuevo'; badge.className = 'badge';

    // Cargar las properties reales del nodo core y pre-llenar el form
    fetch(`/api/nodes/official/${name}`)
        .then(r => r.json())
        .then(data => {
            document.getElementById('displayName').value = `My ${name}`;
            document.getElementById('name').value = `my${name}`;
            document.getElementById('description').value = data.description || '';
            document.getElementById('category').value = (data.group || ['input'])[0];
            document.getElementById('editor-title').textContent = `My ${name}`;
            (data.properties || []).forEach(p => addProperty(p));
            generateCode();
        })
        .catch(() => {
            document.getElementById('displayName').value = `My ${name}`;
            document.getElementById('name').value = `my${name}`;
            document.getElementById('editor-title').textContent = `My ${name}`;
            generateCode();
        });
}

// ── Editor: CRUD ──
function createNewNode() {
    state.selectedCoreNode = null;
    state.properties = []; state.operations = [];
    clearForm();
    document.getElementById('node-editor').classList.remove('editor-readonly');
    document.getElementById('core-banner').classList.add('hidden');
    document.querySelector('.code-panel-header span').textContent = 'TypeScript generado';
    showEditor('Nuevo Nodo', false);
    generateCode();
}

function loadCustomNode(name) {
    fetch(`/api/nodes/${name}`)
        .then(r => r.json())
        .then(data => {
            state.selectedCoreNode = null;
            state.properties = []; state.operations = [];
            clearForm();
            fillForm(data);
            document.getElementById('node-editor').classList.remove('editor-readonly');
            document.getElementById('core-banner').classList.add('hidden');
            document.querySelector('.code-panel-header span').textContent = 'TypeScript generado';
            showEditor(name, true);
            generateCode();
        })
        .catch(() => {
            state.selectedCoreNode = null;
            state.properties = []; state.operations = [];
            clearForm();
            document.getElementById('displayName').value = name;
            document.getElementById('name').value = name.toLowerCase();
            document.getElementById('node-editor').classList.remove('editor-readonly');
            document.getElementById('core-banner').classList.add('hidden');
            document.querySelector('.code-panel-header span').textContent = 'TypeScript generado';
            showEditor(name, true);
            generateCode();
        });
}

function showEditor(title, isEditing) {
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('node-editor').classList.remove('hidden');
    document.getElementById('editor-title').textContent = title;
    const badge = document.getElementById('editor-badge');
    badge.textContent = isEditing ? 'Editando' : 'Nuevo';
    badge.className = 'badge' + (isEditing ? ' editing' : '');
}

function clearForm() {
    ['displayName','name','description','baseUrl'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('category').value = 'input';
    document.getElementById('has-auth').checked = false;
    document.getElementById('has-operations').checked = false;
    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('operations-container').classList.add('hidden');
    document.getElementById('properties-list').innerHTML = '';
    document.getElementById('operations-list').innerHTML = '';
    state.properties = []; state.operations = [];
}

function fillForm(data) {
    document.getElementById('displayName').value = data.displayName || '';
    document.getElementById('name').value = data.name || '';
    document.getElementById('description').value = data.description || '';
    document.getElementById('category').value = data.category || 'input';
    document.getElementById('baseUrl').value = data.baseUrl || '';
    document.getElementById('editor-title').textContent = data.displayName || 'Sin título';
    if (data.hasAuth) {
        document.getElementById('has-auth').checked = true;
        document.getElementById('auth-container').classList.remove('hidden');
        document.getElementById('auth-type').value = data.authType || 'apiKey';
    }
    if (data.hasOperations && data.operations?.length) {
        document.getElementById('has-operations').checked = true;
        document.getElementById('operations-container').classList.remove('hidden');
        data.operations.forEach(op => addOperation(op));
    }
    (data.properties || []).forEach(p => addProperty(p));
}

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Propiedades ──
function addProperty(data = null) {
    const prop = data || { displayName: '', name: '', type: 'string', default: '', description: '', options: [] };
    if (!prop.options) prop.options = [];
    // Serializar default si es objeto
    if (typeof prop.default === 'object') prop.default = JSON.stringify(prop.default);
    prop.default = String(prop.default ?? '');
    prop.description = typeof prop.description === 'string' ? prop.description.replace(/<[^>]*>/g, '') : '';
    state.properties.push(prop);
    const idx = state.properties.length - 1;
    const div = document.createElement('div');
    div.className = 'prop-card';

    const allTypes = ['string','number','boolean','options','multiOptions','collection','fixedCollection','json','filter','dateTime'];
    const typeOptions = allTypes.map(t => `<option value="${t}" ${prop.type===t?'selected':''}>${t}</option>`).join('');

    const hasOptions = ['options','multiOptions'].includes(prop.type);
    const optionsHtml = hasOptions ? `
        <div class="form-group" id="options-group-${idx}">
            <label>Opciones (una por línea: valor|Nombre visible)</label>
            <textarea oninput="updatePropOptions(${idx}, this.value)" rows="4">${(prop.options||[]).map(o => typeof o === 'object' ? o.value+'|'+o.name : o).join('\n')}</textarea>
        </div>` : `<div id="options-group-${idx}"></div>`;

    div.innerHTML = `
        <div class="card-header">
            <span>Propiedad ${idx + 1}</span>
            <button class="btn-remove" onclick="removeProperty(${idx})">Eliminar</button>
        </div>
        <div class="form-row">
            <div class="form-group"><label>Nombre visible</label>
                <input type="text" value="${escHtml(prop.displayName)}" oninput="updateProp(${idx},'displayName',this.value)"></div>
            <div class="form-group"><label>Nombre interno</label>
                <input type="text" value="${escHtml(prop.name)}" oninput="updateProp(${idx},'name',this.value)"></div>
        </div>
        <div class="form-row">
            <div class="form-group"><label>Tipo</label>
                <select onchange="updatePropType(${idx}, this.value)">${typeOptions}</select></div>
            <div class="form-group"><label>Default</label>
                <input type="text" value="${escHtml(prop.default)}" oninput="updateProp(${idx},'default',this.value)"></div>
        </div>
        <div class="form-group"><label>Descripción</label>
            <input type="text" value="${escHtml(prop.description)}" oninput="updateProp(${idx},'description',this.value)"></div>
        ${optionsHtml}`;
    document.getElementById('properties-list').appendChild(div);
}

function updatePropType(idx, value) {
    if (!state.properties[idx]) return;
    state.properties[idx].type = value;
    state.properties[idx].options = state.properties[idx].options || [];
    // Re-render solo la prop card
    const list = document.getElementById('properties-list');
    const cards = list.querySelectorAll('.prop-card');
    if (cards[idx]) {
        const copy = [...state.properties];
        state.properties = [];
        document.getElementById('properties-list').innerHTML = '';
        copy.forEach(p => addProperty(p));
    }
    generateCode();
}

function updatePropOptions(idx, text) {
    if (!state.properties[idx]) return;
    state.properties[idx].options = text.split('\n').filter(l => l.trim()).map(l => {
        const [value, name] = l.split('|');
        return { value: value.trim(), name: (name || value).trim() };
    });
    generateCode();
}

function updateProp(idx, field, value) {
    if (state.properties[idx]) { state.properties[idx][field] = value; generateCode(); }
}

function removeProperty(idx) {
    state.properties.splice(idx, 1);
    document.getElementById('properties-list').innerHTML = '';
    const copy = [...state.properties]; state.properties = [];
    copy.forEach(p => addProperty(p)); generateCode();
}

// ── Operaciones ──
function addOperation(data = null) {
    const op = data || { name: '', method: 'GET', url: '' };
    state.operations.push(op);
    const idx = state.operations.length - 1;
    const div = document.createElement('div');
    div.className = 'op-card';
    div.innerHTML = `
        <div class="card-header">
            <span>Operación ${idx + 1}</span>
            <button class="btn-remove" onclick="removeOperation(${idx})">Eliminar</button>
        </div>
        <div class="form-row">
            <div class="form-group"><label>Nombre</label>
                <input type="text" value="${op.name}" oninput="updateOp(${idx},'name',this.value)"></div>
            <div class="form-group"><label>Método</label>
                <select onchange="updateOp(${idx},'method',this.value)">
                    ${['GET','POST','PUT','PATCH','DELETE'].map(m =>
                        `<option value="${m}" ${op.method===m?'selected':''}>${m}</option>`).join('')}
                </select></div>
        </div>
        <div class="form-group"><label>URL</label>
            <input type="text" value="${op.url}" placeholder="/endpoint/{{$parameter.id}}" oninput="updateOp(${idx},'url',this.value)"></div>`;
    document.getElementById('operations-list').appendChild(div);
}

function updateOp(idx, field, value) {
    if (state.operations[idx]) { state.operations[idx][field] = value; generateCode(); }
}

function removeOperation(idx) {
    state.operations.splice(idx, 1);
    document.getElementById('operations-list').innerHTML = '';
    const copy = [...state.operations]; state.operations = [];
    copy.forEach(o => addOperation(o)); generateCode();
}

// ── Guardar nodo ──
function saveNode() {
    const nodeData = getFormData();
    if (!nodeData.name || !nodeData.displayName) { document.getElementById('displayName').focus(); return; }
    const code = buildCode(nodeData);
    fetch('/api/nodes/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeData, code }),
    })
    .then(r => r.json())
    .then(() => {
        const badge = document.getElementById('editor-badge');
        badge.textContent = 'Guardado ✓'; badge.className = 'badge editing';
        setTimeout(() => { badge.textContent = 'Editando'; }, 2000);
        loadCustomNodes();
    });
}

function generateCode() {
    document.getElementById('generated-code').textContent = buildCode(getFormData());
}

function copyCode() {
    navigator.clipboard.writeText(document.getElementById('generated-code').textContent).then(() => {
        const btn = document.querySelector('.btn-copy');
        btn.textContent = 'Copiado ✓';
        setTimeout(() => { btn.textContent = 'Copiar'; }, 2000);
    });
}

function getFormData() {
    return {
        displayName: document.getElementById('displayName').value,
        name: document.getElementById('name').value,
        description: document.getElementById('description').value,
        category: document.getElementById('category').value,
        baseUrl: document.getElementById('baseUrl').value,
        hasAuth: document.getElementById('has-auth').checked,
        authType: document.getElementById('auth-type').value,
        hasOperations: document.getElementById('has-operations').checked,
        properties: state.properties,
        operations: state.operations,
    };
}

function buildCode(d) {
    const cls = d.name ? d.name.charAt(0).toUpperCase() + d.name.slice(1) : 'MyNode';
    const propsCode = d.properties.map(p => {
        const optionsCode = (p.options && p.options.length) ? `,
            options: [${p.options.map(o => `
                { name: '${(o.name||o.value||o).toString().replace(/'/g,"\\'")}'  , value: '${(o.value||o).toString().replace(/'/g,"\\'")}'  }`).join(',')}\n            ]` : '';
        return `
        {
            displayName: '${p.displayName}',
            name: '${p.name}',
            type: '${p.type}',
            default: '${p.default || ''}',
            description: '${p.description || ''}',${optionsCode}
        }`;
    }).join(',');
    const opsCode = d.hasOperations && d.operations.length ? `
        {
            displayName: 'Operation',
            name: 'operation',
            type: 'options',
            noDataExpression: true,
            options: [${d.operations.map(op => `
                {
                    name: '${op.name}',
                    value: '${op.name.toLowerCase().replace(/\s+/g,'')}',
                    action: '${op.name}',
                    routing: { request: { method: '${op.method}', url: '${op.url}' } },
                }`).join(',')}
            ],
            default: '${d.operations[0]?.name.toLowerCase().replace(/\s+/g,'') || ''}',
        },` : '';
    const credCode = d.hasAuth ? `
        credentials: [{ name: '${d.name}Api', required: true }],` : '';
    const reqCode = d.baseUrl ? `
        requestDefaults: {
            baseURL: '${d.baseUrl}',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        },` : '';
    return `import type {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

export class ${cls} implements INodeType {
    description: INodeTypeDescription = {
        displayName: '${d.displayName}',
        name: '${d.name}',
        icon: 'file:${d.name}.svg',
        group: ['${d.category}'],
        version: 1,
        description: '${d.description}',
        defaults: { name: '${d.displayName}' },
        inputs: [NodeConnectionTypes.Main],
        outputs: [NodeConnectionTypes.Main],${credCode}${reqCode}
        properties: [${opsCode}${propsCode}
        ],
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];
        for (let i = 0; i < items.length; i++) {
            returnData.push({ json: items[i].json });
        }
        return [returnData];
    }
}`;
}

// ── Servidores ──
function loadServers() {
    fetch('/api/servers')
        .then(r => r.json())
        .then(servers => { state.servers = servers; renderServersList(); })
        .catch(() => { state.servers = []; renderServersList(); });
}

function renderServersList() {
    const list = document.getElementById('servers-list');
    list.innerHTML = '';
    state.servers.forEach(srv => {
        const div = document.createElement('div');
        div.className = 'server-item' + (state.editingServerId === srv.id ? ' active' : '');
        div.innerHTML = `
            <div class="server-item-name">${srv.name}</div>
            <div class="server-item-host">${srv.host}</div>
            `;
        div.addEventListener('click', () => editServer(srv.id));
        list.appendChild(div);
    });
}

function setupServerListeners() {
    document.getElementById('srv-has-path').addEventListener('change', e => {
        document.getElementById('path-container').classList.toggle('hidden', !e.target.checked);
        setConnectionStatus(null);
    });
}

function newServer() {
    state.editingServerId = null;
    clearServerForm();
    document.getElementById('server-form-empty').classList.add('hidden');
    document.getElementById('server-form').classList.remove('hidden');
    document.getElementById('btn-delete-server').style.display = 'none';
    setConnectionStatus(null);
    renderServersList();
}

function editServer(id) {
    const srv = state.servers.find(s => s.id === id);
    if (!srv) return;
    state.editingServerId = id;
    document.getElementById('server-form-empty').classList.add('hidden');
    document.getElementById('server-form').classList.remove('hidden');
    document.getElementById('btn-delete-server').style.display = 'inline-flex';
    setConnectionStatus(null);
    document.getElementById('srv-name').value = srv.name;
    document.getElementById('srv-host').value = srv.host;
    document.getElementById('srv-has-path').checked = srv.hasPath || false;
    document.getElementById('path-container').classList.toggle('hidden', !srv.hasPath);
    if (srv.hasPath) document.getElementById('srv-path').value = srv.path || '';
    renderServersList();
}

function clearServerForm() {
    ['srv-name','srv-host','srv-path'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('srv-has-path').checked = false;
    document.getElementById('path-container').classList.add('hidden');
    setConnectionStatus(null);
}

function setConnectionStatus(status, message = '') {
    const el = document.getElementById('connection-status');
    const btn = document.getElementById('btn-save-server');
    if (status === null) {
        el.classList.add('hidden');
        btn.disabled = true;
        return;
    }
    el.classList.remove('hidden', 'ok', 'fail', 'testing');
    el.classList.add(status);
    el.textContent = message;
    btn.disabled = status !== 'ok';
}

function testConnection() {
    const data = { host: document.getElementById('srv-host').value };
    if (!data.host) {
        setConnectionStatus('fail', '✗ Completá la URL antes de testear.');
        return;
    }
    setConnectionStatus('testing', '⟳ Testeando conexión...');
    fetch('/api/servers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    })
    .then(r => r.json())
    .then(result => {
        if (result.success) setConnectionStatus('ok', '✓ Conexión exitosa. Podés guardar el servidor.');
        else setConnectionStatus('fail', '✗ ' + result.error);
    })
    .catch(err => setConnectionStatus('fail', '✗ Error: ' + err.message));
}

function saveServer() {
    const hasPath = document.getElementById('srv-has-path').checked;
    const srv = {
        id: state.editingServerId || Date.now().toString(),
        name: document.getElementById('srv-name').value,
        host: document.getElementById('srv-host').value,
        hasPath,
        path: hasPath ? document.getElementById('srv-path').value : null,
    };
    if (!srv.name || !srv.host) {
        document.getElementById('srv-name').focus(); return;
    }
    fetch('/api/servers/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(srv),
    })
    .then(r => r.json())
    .then(() => { loadServers(); state.editingServerId = srv.id; });
}

function deleteServer() {
    if (!state.editingServerId) return;
    fetch(`/api/servers/${state.editingServerId}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(() => {
            state.editingServerId = null;
            document.getElementById('server-form').classList.add('hidden');
            document.getElementById('server-form-empty').classList.remove('hidden');
            loadServers();
        });
}

// ── Deploy ──
function refreshDeploySection() {
    // Nodos
    const nodesList = document.getElementById('deploy-nodes-list');
    nodesList.innerHTML = '';
    state.customNodes.forEach(name => {
        const div = document.createElement('div');
        div.className = 'deploy-item';
        div.innerHTML = `
            <input type="checkbox" id="deploy-node-${name}" value="${name}">
            <label for="deploy-node-${name}" class="deploy-item-label">${name}</label>`;
        div.addEventListener('click', e => {
            if (e.target.tagName !== 'INPUT') div.querySelector('input').click();
            div.classList.toggle('selected', div.querySelector('input').checked);
        });
        nodesList.appendChild(div);
    });

    // Servidores
    const srvList = document.getElementById('deploy-servers-list');
    srvList.innerHTML = '';
    state.servers.forEach(srv => {
        const div = document.createElement('div');
        div.className = 'deploy-item';
        div.innerHTML = `
            <input type="radio" name="deploy-server" id="deploy-srv-${srv.id}" value="${srv.id}">
            <div>
                <div class="deploy-item-label">${srv.name}</div>
                <div class="deploy-item-sub">${srv.host}</div>
            </div>`;
        div.addEventListener('click', e => {
            if (e.target.tagName !== 'INPUT') div.querySelector('input').click();
            document.querySelectorAll('#deploy-servers-list .deploy-item').forEach(d => d.classList.remove('selected'));
            div.classList.add('selected');
        });
        srvList.appendChild(div);
    });
}

function runDeploy() {
    const selectedNodes = [...document.querySelectorAll('#deploy-nodes-list input:checked')].map(i => i.value);
    const selectedServer = document.querySelector('input[name="deploy-server"]:checked')?.value;

    if (!selectedNodes.length) { appendLog('⚠ Seleccioná al menos un nodo.', 'log-error'); return; }
    if (!selectedServer) { appendLog('⚠ Seleccioná un servidor destino.', 'log-error'); return; }

    const btn = document.querySelector('.btn-deploy');
    btn.disabled = true;
    btn.textContent = 'Importando...';

    appendLog(`\n▶ Iniciando deploy de: ${selectedNodes.join(', ')}`, 'log-info');
    appendLog(`  Servidor: ${state.servers.find(s => s.id === selectedServer)?.name}`, 'log-info');

    fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: selectedNodes, serverId: selectedServer }),
    })
    .then(r => r.json())
    .then(result => {
        if (result.success) {
            appendLog('\n' + result.output, 'log-info');
            appendLog('\n✓ Build completado. Reiniciá n8n para ver los cambios.', 'log-success');
        } else {
            appendLog('\n✗ Error: ' + result.error, 'log-error');
        }
    })
    .catch(err => appendLog('\n✗ Error de conexión: ' + err.message, 'log-error'))
    .finally(() => { btn.disabled = false; btn.textContent = '↑ Importar seleccionados'; });
}

function appendLog(text, cls = '') {
    const log = document.getElementById('build-log');
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text + '\n';
    log.appendChild(span);
    log.scrollTop = log.scrollHeight;
}

function clearLog() {
    document.getElementById('build-log').innerHTML = '';
}

// ── Globales ──
window.addProperty = addProperty;
window.addOperation = addOperation;
window.removeProperty = removeProperty;
window.removeOperation = removeOperation;
window.updateProp = updateProp;
window.updatePropType = updatePropType;
window.updatePropOptions = updatePropOptions;
window.updateOp = updateOp;
window.createNewNode = createNewNode;
window.useAsBase = useAsBase;
window.saveNode = saveNode;
window.generateCode = generateCode;
window.copyCode = copyCode;
window.saveServer = saveServer;
window.deleteServer = deleteServer;
window.newServer = newServer;
window.testConnection = testConnection;
window.runDeploy = runDeploy;

// ── SSH ──
const sshState = {
    connections: [],
    editingId: null,
    term: null,
    fitAddon: null,
    ws: null,
};

function loadSshConnections() {
    fetch('/api/ssh/connections')
        .then(r => r.json())
        .then(conns => { sshState.connections = conns; renderSshList(); })
        .catch(() => { sshState.connections = []; renderSshList(); });
}

function renderSshList() {
    const list = document.getElementById('ssh-connections-list');
    list.innerHTML = '';
    sshState.connections.forEach(conn => {
        const div = document.createElement('div');
        div.className = 'ssh-conn-item' + (sshState.editingId === conn.id ? ' active' : '');
        div.innerHTML = `
            <div class="ssh-conn-name">
                <span class="ssh-conn-dot ${sshState.ws && sshState.editingId === conn.id ? 'on' : ''}"></span>
                ${conn.name}
            </div>
            <div class="ssh-conn-host">${conn.user}@${conn.host}:${conn.port || 22}</div>`;
        div.addEventListener('click', () => loadSshConnection(conn.id));
        list.appendChild(div);
    });
}

function initTerminal() {
    if (sshState.term) return;
    sshState.term = new Terminal({
        theme: { background: '#0d0d0d', foreground: '#e8e8e8', cursor: '#ff6b35' },
        fontFamily: 'Monaco, Menlo, Courier New, monospace',
        fontSize: 13,
        lineHeight: 1.4,
        cursorBlink: true,
    });
    sshState.fitAddon = new FitAddon.FitAddon();
    sshState.term.loadAddon(sshState.fitAddon);
    sshState.term.open(document.getElementById('terminal'));
    sshState.fitAddon.fit();

    window.addEventListener('resize', () => {
        if (sshState.fitAddon) sshState.fitAddon.fit();
    });

    sshState.term.onData(data => {
        if (sshState.ws && sshState.ws.readyState === WebSocket.OPEN) {
            sshState.ws.send(JSON.stringify({ type: 'input', data }));
        }
    });

    sshState.term.onResize(({ cols, rows }) => {
        if (sshState.ws && sshState.ws.readyState === WebSocket.OPEN) {
            sshState.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
    });
}

function newSshConnection() {
    sshState.editingId = null;
    clearSshForm();
    document.getElementById('ssh-form-empty').classList.add('hidden');
    document.getElementById('ssh-panel').classList.remove('hidden');
    document.getElementById('btn-delete-ssh').style.display = 'none';
    initTerminal();
    renderSshList();
}

function loadSshConnection(id) {
    const conn = sshState.connections.find(c => c.id === id);
    if (!conn) return;
    sshState.editingId = id;
    document.getElementById('ssh-form-empty').classList.add('hidden');
    document.getElementById('ssh-panel').classList.remove('hidden');
    document.getElementById('btn-delete-ssh').style.display = 'inline-flex';
    document.getElementById('ssh-name').value = conn.name;
    document.getElementById('ssh-host').value = conn.host;
    document.getElementById('ssh-port').value = conn.port || '22';
    document.getElementById('ssh-user').value = conn.user;
    document.getElementById('ssh-password').value = conn.password || '';
    initTerminal();
    renderSshList();
}

function clearSshForm() {
    ['ssh-name','ssh-host','ssh-user','ssh-password'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('ssh-port').value = '22';
}

function saveSshConnection() {
    const conn = {
        id: sshState.editingId || Date.now().toString(),
        name: document.getElementById('ssh-name').value,
        host: document.getElementById('ssh-host').value,
        port: document.getElementById('ssh-port').value || '22',
        user: document.getElementById('ssh-user').value,
        password: document.getElementById('ssh-password').value,
    };
    if (!conn.name || !conn.host || !conn.user) {
        document.getElementById('ssh-name').focus(); return;
    }
    fetch('/api/ssh/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conn),
    })
    .then(r => r.json())
    .then(() => { sshState.editingId = conn.id; loadSshConnections(); });
}

function deleteSshConnection() {
    if (!sshState.editingId) return;
    sshDisconnect();
    fetch(`/api/ssh/${sshState.editingId}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(() => {
            sshState.editingId = null;
            document.getElementById('ssh-panel').classList.add('hidden');
            document.getElementById('ssh-form-empty').classList.remove('hidden');
            loadSshConnections();
        });
}

function sshConnect() {
    const conn = {
        host: document.getElementById('ssh-host').value,
        port: document.getElementById('ssh-port').value || '22',
        user: document.getElementById('ssh-user').value,
        password: document.getElementById('ssh-password').value,
    };
    if (!conn.host || !conn.user) return;

    sshDisconnect();
    initTerminal();
    sshState.term.clear();

    const ws = new WebSocket(`ws://localhost:3000/ssh/terminal`);
    sshState.ws = ws;

    ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'connect', ...conn }));
        setTerminalStatus(true);
    };

    ws.onmessage = e => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'output') sshState.term.write(msg.data);
        if (msg.type === 'error') { sshState.term.write(`\r\n\x1b[31m${msg.data}\x1b[0m\r\n`); setTerminalStatus(false); }
        if (msg.type === 'close') setTerminalStatus(false);
    };

    ws.onclose = () => setTerminalStatus(false);
    ws.onerror = () => setTerminalStatus(false);

    setTimeout(() => sshState.fitAddon?.fit(), 100);
}

function sshDisconnect() {
    if (sshState.ws) {
        sshState.ws.close();
        sshState.ws = null;
    }
    setTerminalStatus(false);
}

function setTerminalStatus(connected) {
    const el = document.getElementById('terminal-status');
    const btn = document.getElementById('btn-ssh-disconnect');
    el.textContent = connected ? 'Conectado' : 'Desconectado';
    el.className = 'terminal-status' + (connected ? ' connected' : '');
    btn.style.display = connected ? 'inline-flex' : 'none';
    renderSshList();
}

// ── JSON Import ──
function applyNodeJson() {
    const raw = document.getElementById('json-import-input').value.trim();
    if (!raw) return;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return; }

    let node = parsed;
    if (parsed.nodes?.length > 0) node = parsed.nodes[0];
    else if (Array.isArray(parsed) && parsed.length > 0) node = parsed[0];

    const params = node.parameters || {};

    if (node.name) {
        document.getElementById('displayName').value = node.name;
        const internal = node.name.replace(/\s+(.)/g, (_, c) => c.toUpperCase()).replace(/^(.)/, c => c.toLowerCase()).replace(/[^a-z0-9]/gi, '');
        document.getElementById('name').value = internal;
        document.getElementById('editor-title').textContent = node.name;
    }

    state.properties = []; state.operations = [];
    document.getElementById('properties-list').innerHTML = '';
    document.getElementById('operations-list').innerHTML = '';
    document.getElementById('has-auth').checked = false;
    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('has-operations').checked = false;
    document.getElementById('operations-container').classList.add('hidden');
    document.getElementById('baseUrl').value = '';

    const SIMPLE = (v) => typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number';

    Object.entries(params).forEach(([key, value]) => {
        if (key === 'options' && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return;
        if (key === 'method' || key === 'url') return;

        if (SIMPLE(value)) {
            const type = typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string';
            addProperty({ displayName: key, name: key, type, default: String(value), description: '' });
        } else if ((key === 'bodyParameters' || key === 'queryParameters' || key === 'headerParameters') && value?.parameters) {
            value.parameters.forEach(p => {
                addProperty({ displayName: key + ': ' + p.name, name: key + '_' + p.name, type: 'string', default: p.value || '', description: '' });
            });
        } else {
            addProperty({ displayName: key, name: key, type: 'json', default: JSON.stringify(value, null, 2), description: '' });
        }
    });

    const url = params.url || '';
    const method = params.method;
    if (method && url) {
        const urlMatch = url.match(/^(https?:\/\/[^/]+)/);
        if (urlMatch) document.getElementById('baseUrl').value = urlMatch[1];
        document.getElementById('has-operations').checked = true;
        document.getElementById('operations-container').classList.remove('hidden');
        addOperation({ name: node.name || method, method, url: urlMatch ? url.replace(urlMatch[1], '') || '/' : url });
    }

    generateCode();
}

window.deleteCustomNode = deleteCustomNode;
window.applyNodeJson = applyNodeJson;
window.toggleTheme = toggleTheme;
window.saveSshConnection = saveSshConnection;
window.deleteSshConnection = deleteSshConnection;
window.sshConnect = sshConnect;
window.sshDisconnect = sshDisconnect;
