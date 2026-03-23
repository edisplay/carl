/**
 * CARL Domains — Domain CRUD tools
 * Migrated from DRL-engine MCP, renamed drl_* → carl_*
 */

import { readFileSync, existsSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const CARL_FOLDER = '.carl';

function debugLog(...args) {
    console.error('[CARL:domains]', new Date().toISOString(), ...args);
}

// ============================================================
// FILE PARSING
// ============================================================

function findCarlFiles(workspacePath) {
    const files = {};
    const carlPath = join(workspacePath, CARL_FOLDER);

    try {
        if (!existsSync(carlPath)) {
            debugLog('CARL folder not found:', carlPath);
            return files;
        }

        const entries = readdirSync(carlPath);
        for (const entry of entries) {
            if (!entry.startsWith('.') && !entry.startsWith('sessions') && !entry.startsWith('skool')) {
                files[entry] = join(carlPath, entry);
            }
        }
    } catch (error) {
        debugLog('Error reading CARL folder:', error.message);
    }

    return files;
}

function applyManifestEntry(domains, key, value) {
    const suffixes = [
        { suffix: '_STATE', len: 6, handler: (d, v) => { d.state = ['active', 'true', 'yes', '1'].includes(v.toLowerCase()); } },
        { suffix: '_ALWAYS_ON', len: 10, handler: (d, v) => { d.always_on = ['true', 'yes', '1'].includes(v.toLowerCase()); } },
        { suffix: '_RECALL', len: 7, handler: (d, v) => { d.recall = v; } }
    ];

    for (const { suffix, len, handler } of suffixes) {
        if (key.endsWith(suffix)) {
            const domain = key.slice(0, -len);
            if (!domains[domain]) domains[domain] = {};
            handler(domains[domain], value);
            return;
        }
    }
}

function parseManifest(filepath) {
    const domains = {};
    if (!existsSync(filepath)) return domains;

    const content = readFileSync(filepath, 'utf-8');
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const [key, value] = trimmed.split('=', 2);
        applyManifestEntry(domains, key.trim(), value.trim());
    }

    return domains;
}

function parseDomainRules(filepath, domainName) {
    const rules = [];
    if (!existsSync(filepath)) return rules;

    const content = readFileSync(filepath, 'utf-8');
    const prefix = `${domainName}_RULE_`;

    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const [key, value] = trimmed.split('=', 2);
        const k = key.trim();
        const v = value.trim();

        if (k.startsWith(prefix) && v) {
            const num = Number.parseInt(k.replace(prefix, ''), 10);
            rules.push({ num, text: v });
        }
    }

    rules.sort((a, b) => a.num - b.num);
    return rules;
}

// ============================================================
// TOOL DEFINITIONS
// ============================================================

export const TOOLS = [
    {
        name: "carl_list_domains",
        description: "List all available CARL domains with state from manifest.",
        inputSchema: { type: "object", properties: {} }
    },
    {
        name: "carl_get_domain_rules",
        description: "Load rules for a specific CARL domain. Use when user intent matches domain recall keywords.",
        inputSchema: {
            type: "object",
            properties: {
                domain: { type: "string", description: "Domain name (e.g., 'PROJECTS', 'CONTENT'). Case-insensitive." }
            },
            required: ["domain"]
        }
    },
    {
        name: "carl_create_domain",
        description: "Create a new CARL domain with file and manifest entry.",
        inputSchema: {
            type: "object",
            properties: {
                domain: { type: "string", description: "Domain name in UPPERCASE (e.g., 'TESTING')" },
                description: { type: "string", description: "Brief description of when this domain applies" },
                recall: { type: "string", description: "Comma-separated recall keywords that trigger this domain" },
                rules: { type: "array", items: { type: "string" }, description: "Array of rule strings (Rule 0 auto-generated from description)" }
            },
            required: ["domain", "description", "recall", "rules"]
        }
    },
    {
        name: "carl_toggle_domain",
        description: "Enable or disable a CARL domain by updating the manifest.",
        inputSchema: {
            type: "object",
            properties: {
                domain: { type: "string", description: "Domain name to toggle (e.g., 'PROJECTS')" },
                state: { type: "string", enum: ["active", "inactive"], description: "New state" }
            },
            required: ["domain", "state"]
        }
    },
    {
        name: "carl_get_manifest",
        description: "Get current CARL manifest showing all domains, states, and recall keywords.",
        inputSchema: { type: "object", properties: {} }
    }
];

// ============================================================
// TOOL HANDLERS
// ============================================================

export async function handleTool(name, args, workspacePath) {
    switch (name) {
        case "carl_list_domains": return listDomains(workspacePath);
        case "carl_get_domain_rules": return getDomainRules(args, workspacePath);
        case "carl_create_domain": return createDomain(args, workspacePath);
        case "carl_toggle_domain": return toggleDomain(args, workspacePath);
        case "carl_get_manifest": return getManifest(workspacePath);
        default: return null;
    }
}

async function listDomains(workspacePath) {
    const files = findCarlFiles(workspacePath);
    debugLog('Listing domains');

    const domainFiles = Object.entries(files)
        .filter(([type]) => type !== 'manifest' && type !== 'context')
        .map(([type, filepath]) => ({
            domain: type.toUpperCase(),
            file: `.carl/${type}`,
            path: filepath
        }));

    return {
        success: true,
        workspace: workspacePath,
        domain_count: domainFiles.length,
        domains: domainFiles,
        special_files: {
            manifest: files.manifest || null,
            context: files.context || null
        }
    };
}

async function getDomainRules(args, workspacePath) {
    const domain = args.domain.toUpperCase();
    const files = findCarlFiles(workspacePath);
    debugLog('Getting rules for domain:', domain);

    let domainFile = files[domain.toLowerCase()];
    let isCommandExtraction = false;

    if (!domainFile && files.commands) {
        debugLog('No dedicated file, checking commands file for:', domain);
        domainFile = files.commands;
        isCommandExtraction = true;
    }

    if (!domainFile) {
        return {
            success: false,
            error: `Domain file not found: .carl/${domain.toLowerCase()}`,
            available_domains: Object.keys(files).filter(k => k !== 'manifest' && k !== 'context')
        };
    }

    const rules = parseDomainRules(domainFile, domain);

    if (rules.length === 0) {
        return {
            success: false,
            error: `No ${domain}_RULE_* entries found`,
            domain
        };
    }

    const formatted = rules.map(r => `[${domain}] Rule ${r.num}: ${r.text}`);

    return {
        success: true,
        domain,
        rule_count: rules.length,
        rules: formatted,
        source: isCommandExtraction ? 'commands' : 'dedicated',
        instruction: `${domain} rules loaded. Apply these rules to the current context.`
    };
}

async function createDomain(args, workspacePath) {
    const domain = args.domain.toUpperCase();
    const domainLower = domain.toLowerCase();
    const { description, recall, rules = [] } = args;
    const files = findCarlFiles(workspacePath);

    debugLog('Creating domain:', domain);

    if (files[domainLower]) {
        return { success: false, error: `Domain already exists: ${domain}`, existing_file: files[domainLower] };
    }

    if (!files.manifest) {
        return { success: false, error: 'Manifest not found' };
    }

    const domainFilePath = join(workspacePath, CARL_FOLDER, domainLower);

    let domainContent = `# Dynamic Rules Loader V2 - ${domain} Domain
# ${'='.repeat(40)}
# ${description}
#
# Domain Configuration (synced with .carl/manifest)
${domain}_STATE=active
${domain}_ALWAYS_ON=false

# Rule 0: Self-referencing relevance instruction
${domain}_RULE_0=${domain} rules apply when ${description.toLowerCase()}. If these rules are loaded but the request doesn't involve this domain, note that ${domain} rules are active but may not be needed.

# ============================================================================
# ${domain} Rules
# ============================================================================
`;

    for (let i = 0; i < rules.length; i++) {
        domainContent += `${domain}_RULE_${i + 1}=${rules[i]}\n`;
    }

    writeFileSync(domainFilePath, domainContent, 'utf-8');

    const manifestContent = readFileSync(files.manifest, 'utf-8');
    const manifestEntry = `
# ============================================================================
# ${domain} - ${description}
# ============================================================================
${domain}_STATE=active
${domain}_ALWAYS_ON=false
${domain}_RECALL=${recall}
# ${domain}_EXCLUDE=
`;

    writeFileSync(files.manifest, manifestContent + manifestEntry, 'utf-8');

    return {
        success: true,
        domain,
        domain_file: domainFilePath,
        rule_count: rules.length + 1,
        recall_keywords: recall,
        message: `Domain ${domain} created. File: .carl/${domainLower}, Manifest updated.`
    };
}

async function toggleDomain(args, workspacePath) {
    const domain = args.domain.toUpperCase();
    const newState = args.state.toLowerCase();
    const files = findCarlFiles(workspacePath);

    debugLog('Toggling domain:', domain, 'to', newState);

    if (!files.manifest) {
        return { success: false, error: 'Manifest not found' };
    }

    const content = readFileSync(files.manifest, 'utf-8');
    const lines = content.split('\n');
    const stateKey = `${domain}_STATE`;
    let found = false;

    const newLines = lines.map(line => {
        if (line.trim().startsWith(stateKey + '=')) {
            found = true;
            return `${stateKey}=${newState}`;
        }
        return line;
    });

    if (!found) {
        return { success: false, error: `Domain not found in manifest: ${domain}` };
    }

    writeFileSync(files.manifest, newLines.join('\n'), 'utf-8');

    return {
        success: true,
        domain,
        new_state: newState,
        message: `${domain} is now ${newState}. Change persisted to manifest.`
    };
}

async function getManifest(workspacePath) {
    const files = findCarlFiles(workspacePath);
    debugLog('Getting manifest');

    if (!files.manifest) {
        return { success: false, error: 'Manifest not found' };
    }

    const domains = parseManifest(files.manifest);

    const formatted = {};
    for (const [name, config] of Object.entries(domains)) {
        formatted[name] = {
            state: config.state ? 'active' : 'inactive',
            always_on: config.always_on || false,
            recall: config.recall || ''
        };
    }

    return {
        success: true,
        manifest_path: files.manifest,
        domain_count: Object.keys(domains).length,
        domains: formatted
    };
}
