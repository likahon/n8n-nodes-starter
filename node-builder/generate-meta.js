// Genera core-nodes-meta.json desde los nodos compilados de n8n-nodes-base
const fs = require('fs');
const path = require('path');

const NODES_DIR = './node_modules/n8n-nodes-base/dist/nodes';
const OUT = './core-nodes-meta.json';

const TARGETS = {
    HttpRequest: 'HttpRequest/HttpRequest.node.js',
    Set:         'Set/Set.node.js',
    Code:        'Code/Code.node.js',
    If:          'If/If.node.js',
    Switch:      'Switch/Switch.node.js',
    Merge:       'Merge/Merge.node.js',
    Filter:      'Filter/Filter.node.js',
    SplitInBatches: 'SplitInBatches/SplitInBatches.node.js',
    Wait:        'Wait/Wait.node.js',
    Aggregate:   'ItemLists/ItemLists.node.js',
    DateTime:    'DateTime/DateTime.node.js',
    Crypto:      'Crypto/Crypto.node.js',
    HtmlExtract: 'HtmlExtract/HtmlExtract.node.js',
    Compression: 'Compression/Compression.node.js',
    ItemLists:   'ItemLists/ItemLists.node.js',
};

function getDescription(mod) {
    const cls = mod[Object.keys(mod)[0]];
    const inst = new cls();
    // Nodo versionado
    if (inst.nodeVersions && inst.currentVersion) {
        const v = inst.nodeVersions[inst.currentVersion];
        return v?.description || null;
    }
    return inst.description || null;
}

function cleanProps(props) {
    if (!props) return [];
    return props
        .filter(p => p.name && p.type && p.type !== 'notice' && p.type !== 'curlImport' && p.type !== 'hidden' && p.type !== 'credentials' && p.type !== 'credentialsSelect')
        .map(p => ({
            displayName: p.displayName || p.name,
            name: p.name,
            type: p.type,
            default: p.default !== undefined ? String(p.default) : '',
            description: typeof p.description === 'string' ? p.description : '',
            ...(p.options && Array.isArray(p.options) ? {
                options: p.options
                    .filter(o => o && (o.value !== undefined || typeof o === 'string'))
                    .map(o => typeof o === 'string' ? { name: o, value: o } : { name: o.name || String(o.value), value: String(o.value) })
            } : {}),
        }));
}

const result = {};

for (const [name, file] of Object.entries(TARGETS)) {
    try {
        const mod = require(path.resolve(NODES_DIR, file));
        const desc = getDescription(mod);
        if (!desc) { console.log(`SKIP ${name}: no description`); continue; }
        result[name] = {
            displayName: desc.displayName,
            name: desc.name,
            group: desc.group || ['transform'],
            description: desc.description || '',
            properties: cleanProps(desc.properties),
        };
        console.log(`OK ${name}: ${result[name].properties.length} props`);
    } catch(e) {
        console.log(`ERR ${name}: ${e.message}`);
    }
}

fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`\nEscrito: ${OUT}`);
