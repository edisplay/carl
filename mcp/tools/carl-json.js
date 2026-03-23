/**
 * CARL v2 JSON — Domain, rule, decision, staging, and config tools for carl.json
 * Single consolidated file replaces manifest + domain files + decisions/*.json + staging.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

function debugLog(...args) {
    console.error('[CARL:v2]', new Date().toISOString(), ...args);
}

// ============================================================
// HELPERS
// ============================================================

function getCarlJsonPath(workspacePath) {
    return join(workspacePath, '.carl', 'carl.json');
}

function readCarlJson(workspacePath) {
    const filepath = getCarlJsonPath(workspacePath);
    if (!existsSync(filepath)) {
        return { version: 1, last_modified: null, config: { devmode: false, post_compact_gate: true, global_exclude: [] }, domains: {}, staging: [] };
    }
    try {
        return JSON.parse(readFileSync(filepath, 'utf-8'));
    } catch (error) {
        debugLog('Error reading carl.json:', error.message);
        return { version: 1, last_modified: null, config: {}, domains: {}, staging: [] };
    }
}

function writeCarlJson(workspacePath, data) {
    const filepath = getCarlJsonPath(workspacePath);
    data.last_modified = new Date().toISOString();
    writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

function todayStr() {
    return new Date().toISOString().split('T')[0];
}

function nextRuleId(rules) {
    if (!rules || rules.length === 0) return 0;
    return Math.max(...rules.map(r => r.id)) + 1;
}

function nextDecisionId(domainName, decisions) {
    const prefix = `${domainName.toLowerCase()}-`;
    let max = 0;
    for (const d of (decisions || [])) {
        const match = (d.id || '').match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`));
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > max) max = num;
        }
    }
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

function nextStagingId(staging) {
    let max = 0;
    for (const s of (staging || [])) {
        const match = (s.id || '').match(/^stg-(\d+)$/);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > max) max = num;
        }
    }
    return `stg-${String(max + 1).padStart(3, '0')}`;
}

// ============================================================
// TOOL DEFINITIONS
// ============================================================

export const TOOLS = [
    // Domain operations
    {
        name: "carl_v2_list_domains",
        description: "List all CARL domains from carl.json with rule counts, decision counts, state, and always_on flag.",
        inputSchema: { type: "object", properties: {}, required: [] }
    },
    {
        name: "carl_v2_get_domain",
        description: "Get a full domain object from carl.json including rules, decisions, recall, state.",
        inputSchema: {
            type: "object",
            properties: {
                domain: { type: "string", description: "Domain name (case-insensitive, e.g., 'GLOBAL', 'development')" }
            },
            required: ["domain"]
        }
    },
    {
        name: "carl_v2_create_domain",
        description: "Create a new domain in carl.json with recall keywords and optional initial rules.",
        inputSchema: {
            type: "object",
            properties: {
                domain: { type: "string", description: "Domain name (will be uppercased)" },
                recall: { type: "array", items: { type: "string" }, description: "Recall keyword phrases" },
                rules: { type: "array", items: { type: "string" }, description: "Initial rule texts (optional)" }
            },
            required: ["domain", "recall"]
        }
    },
    {
        name: "carl_v2_toggle_domain",
        description: "Enable or disable a domain in carl.json.",
        inputSchema: {
            type: "object",
            properties: {
                domain: { type: "string", description: "Domain name" },
                state: { type: "string", enum: ["active", "inactive"], description: "New state" }
            },
            required: ["domain", "state"]
        }
    },
    // Rule operations
    {
        name: "carl_v2_add_rule",
        description: "Add a rule to a domain in carl.json. Auto-assigns next sequential ID.",
        inputSchema: {
            type: "object",
            properties: {
                domain: { type: "string", description: "Domain name" },
                text: { type: "string", description: "Rule text" },
                source: { type: "string", enum: ["manual", "psmm", "staging"], description: "Rule origin (default: manual)" }
            },
            required: ["domain", "text"]
        }
    },
    {
        name: "carl_v2_remove_rule",
        description: "Remove a rule from a domain in carl.json by rule ID.",
        inputSchema: {
            type: "object",
            properties: {
                domain: { type: "string", description: "Domain name" },
                rule_id: { type: "integer", description: "Rule ID (integer) to remove" }
            },
            required: ["domain", "rule_id"]
        }
    },
    {
        name: "carl_v2_replace_rules",
        description: "Replace ALL rules in a domain with a new set. Wipes existing rules and writes new ones with sequential IDs. Use for bulk rule updates.",
        inputSchema: {
            type: "object",
            properties: {
                domain: { type: "string", description: "Domain name" },
                rules: { type: "array", items: { type: "string" }, description: "New rule texts (replaces all existing rules)" }
            },
            required: ["domain", "rules"]
        }
    },
    // Decision operations
    {
        name: "carl_v2_log_decision",
        description: "Log a decision to a domain in carl.json. Auto-generates ID.",
        inputSchema: {
            type: "object",
            properties: {
                domain: { type: "string", description: "Domain name" },
                decision: { type: "string", description: "What was decided" },
                rationale: { type: "string", description: "Why this decision was made" },
                recall: { type: "string", description: "Comma-separated recall keywords" }
            },
            required: ["domain", "decision", "rationale", "recall"]
        }
    },
    {
        name: "carl_v2_search_decisions",
        description: "Search decisions across all domains in carl.json by keyword.",
        inputSchema: {
            type: "object",
            properties: {
                keyword: { type: "string", description: "Search keyword (case-insensitive)" }
            },
            required: ["keyword"]
        }
    },
    {
        name: "carl_v2_archive_decision",
        description: "Set a decision's status to 'archived' in carl.json.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Decision ID (e.g., 'global-001')" }
            },
            required: ["id"]
        }
    },
    // Staging operations
    {
        name: "carl_v2_stage_proposal",
        description: "Stage a rule proposal in carl.json staging array.",
        inputSchema: {
            type: "object",
            properties: {
                domain: { type: "string", description: "Target domain for the rule" },
                rule_text: { type: "string", description: "Proposed rule text" },
                rationale: { type: "string", description: "Why this rule should exist" },
                source: { type: "string", enum: ["psmm", "decisions", "manual"], description: "Proposal origin (default: manual)" }
            },
            required: ["domain", "rule_text", "rationale"]
        }
    },
    {
        name: "carl_v2_get_staged",
        description: "List all staged rule proposals from carl.json.",
        inputSchema: { type: "object", properties: {}, required: [] }
    },
    {
        name: "carl_v2_approve_proposal",
        description: "Approve a staged proposal — adds rule to target domain and removes from staging.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Staging entry ID (e.g., 'stg-001')" }
            },
            required: ["id"]
        }
    },
    // Config operations
    {
        name: "carl_v2_get_config",
        description: "Get CARL configuration from carl.json (devmode, post_compact_gate, global_exclude).",
        inputSchema: { type: "object", properties: {}, required: [] }
    },
    {
        name: "carl_v2_update_config",
        description: "Update CARL configuration fields in carl.json. Shallow merge.",
        inputSchema: {
            type: "object",
            properties: {
                data: { type: "object", description: "Config fields to update (e.g., { devmode: true })" }
            },
            required: ["data"]
        }
    }
];

// ============================================================
// TOOL HANDLERS
// ============================================================

// --- Domain handlers ---

async function listDomains(workspacePath) {
    debugLog('Listing domains from carl.json');
    const carl = readCarlJson(workspacePath);
    const domains = [];

    for (const [name, domain] of Object.entries(carl.domains || {})) {
        domains.push({
            domain: name,
            state: domain.state,
            always_on: domain.always_on || false,
            rule_count: (domain.rules || []).length,
            decision_count: (domain.decisions || []).length,
            recall: domain.recall || []
        });
    }

    return { domains, count: domains.length };
}

async function getDomain(args, workspacePath) {
    const domainName = (args.domain || '').toUpperCase();
    if (!domainName) throw new Error('Missing required parameter: domain');

    debugLog('Getting domain:', domainName);
    const carl = readCarlJson(workspacePath);
    const domain = carl.domains[domainName];

    if (!domain) {
        throw new Error(`Domain "${domainName}" not found. Available: ${Object.keys(carl.domains).join(', ')}`);
    }

    return { domain: domainName, ...domain };
}

async function createDomain(args, workspacePath) {
    const domainName = (args.domain || '').toUpperCase();
    if (!domainName) throw new Error('Missing required parameter: domain');
    if (!args.recall || !args.recall.length) throw new Error('Missing required parameter: recall');

    debugLog('Creating domain:', domainName);
    const carl = readCarlJson(workspacePath);

    if (carl.domains[domainName]) {
        throw new Error(`Domain "${domainName}" already exists`);
    }

    const rules = (args.rules || []).map((text, i) => ({
        id: i,
        text,
        added: todayStr(),
        last_reviewed: null,
        source: 'manual'
    }));

    carl.domains[domainName] = {
        state: 'active',
        always_on: false,
        recall: args.recall,
        exclude: [],
        rules,
        decisions: []
    };

    writeCarlJson(workspacePath, carl);

    return { domain: domainName, rule_count: rules.length, recall: args.recall };
}

async function toggleDomain(args, workspacePath) {
    const domainName = (args.domain || '').toUpperCase();
    const newState = args.state;
    if (!domainName) throw new Error('Missing required parameter: domain');
    if (!newState) throw new Error('Missing required parameter: state');

    debugLog('Toggling domain:', domainName, '→', newState);
    const carl = readCarlJson(workspacePath);

    if (!carl.domains[domainName]) {
        throw new Error(`Domain "${domainName}" not found`);
    }

    carl.domains[domainName].state = newState;
    writeCarlJson(workspacePath, carl);

    return { domain: domainName, state: newState };
}

// --- Rule handlers ---

async function addRule(args, workspacePath) {
    const domainName = (args.domain || '').toUpperCase();
    if (!domainName) throw new Error('Missing required parameter: domain');
    if (!args.text) throw new Error('Missing required parameter: text');

    debugLog('Adding rule to:', domainName);
    const carl = readCarlJson(workspacePath);

    if (!carl.domains[domainName]) {
        throw new Error(`Domain "${domainName}" not found`);
    }

    const domain = carl.domains[domainName];
    if (!domain.rules) domain.rules = [];

    const id = nextRuleId(domain.rules);
    const rule = {
        id,
        text: args.text,
        added: todayStr(),
        last_reviewed: null,
        source: args.source || 'manual'
    };

    domain.rules.push(rule);
    writeCarlJson(workspacePath, carl);

    return { domain: domainName, rule_id: id, rule_count: domain.rules.length };
}

async function removeRule(args, workspacePath) {
    const domainName = (args.domain || '').toUpperCase();
    if (!domainName) throw new Error('Missing required parameter: domain');
    if (args.rule_id === undefined) throw new Error('Missing required parameter: rule_id');

    debugLog('Removing rule:', domainName, '#', args.rule_id);
    const carl = readCarlJson(workspacePath);

    if (!carl.domains[domainName]) {
        throw new Error(`Domain "${domainName}" not found`);
    }

    const domain = carl.domains[domainName];
    const idx = (domain.rules || []).findIndex(r => r.id === args.rule_id);

    if (idx === -1) {
        throw new Error(`Rule ${args.rule_id} not found in domain "${domainName}"`);
    }

    const [removed] = domain.rules.splice(idx, 1);
    writeCarlJson(workspacePath, carl);

    return { domain: domainName, removed_rule_id: removed.id, removed_text: removed.text, rule_count: domain.rules.length };
}

async function replaceDomainRules(args, workspacePath) {
    const domainName = (args.domain || '').toUpperCase();
    if (!domainName) throw new Error('Missing required parameter: domain');
    if (!args.rules || !Array.isArray(args.rules)) throw new Error('Missing required parameter: rules (array of strings)');

    debugLog('Replacing all rules in domain:', domainName);
    const carl = readCarlJson(workspacePath);

    if (!carl.domains[domainName]) {
        throw new Error(`Domain "${domainName}" not found`);
    }

    const oldCount = carl.domains[domainName].rules.length;
    carl.domains[domainName].rules = args.rules.map((text, i) => ({
        id: i,
        text,
        added: todayStr(),
        last_reviewed: null,
        source: 'manual'
    }));

    writeCarlJson(workspacePath, carl);

    return { domain: domainName, old_rule_count: oldCount, new_rule_count: args.rules.length };
}

// --- Decision handlers ---

async function logDecision(args, workspacePath) {
    const domainName = (args.domain || '').toUpperCase();
    if (!domainName) throw new Error('Missing required parameter: domain');
    if (!args.decision) throw new Error('Missing required parameter: decision');
    if (!args.rationale) throw new Error('Missing required parameter: rationale');
    if (!args.recall) throw new Error('Missing required parameter: recall');

    debugLog('Logging decision to:', domainName);
    const carl = readCarlJson(workspacePath);

    if (!carl.domains[domainName]) {
        throw new Error(`Domain "${domainName}" not found`);
    }

    const domain = carl.domains[domainName];
    if (!domain.decisions) domain.decisions = [];

    const id = nextDecisionId(domainName, domain.decisions);
    const recallList = args.recall.split(',').map(k => k.trim()).filter(Boolean);

    const entry = {
        id,
        decision: args.decision,
        rationale: args.rationale,
        date: todayStr(),
        source: 'manual',
        recall: recallList,
        status: 'active'
    };

    domain.decisions.push(entry);
    writeCarlJson(workspacePath, carl);

    return { id, domain: domainName, message: `Logged ${id} to ${domainName}` };
}

async function searchDecisions(args, workspacePath) {
    const { keyword } = args;
    if (!keyword) throw new Error('Missing required parameter: keyword');

    debugLog('Searching decisions for:', keyword);
    const carl = readCarlJson(workspacePath);
    const lowerKeyword = keyword.toLowerCase();
    const results = [];

    for (const [domainName, domain] of Object.entries(carl.domains || {})) {
        for (const d of (domain.decisions || [])) {
            if (d.status === 'archived') continue;

            const searchText = [
                d.decision,
                d.rationale,
                ...(d.recall || [])
            ].join(' ').toLowerCase();

            if (searchText.includes(lowerKeyword)) {
                results.push({ ...d, domain: domainName });
            }
        }
    }

    return { keyword, count: results.length, decisions: results };
}

async function archiveDecision(args, workspacePath) {
    const { id } = args;
    if (!id) throw new Error('Missing required parameter: id');

    debugLog('Archiving decision:', id);
    const carl = readCarlJson(workspacePath);

    // Extract domain from ID (e.g., 'global-001' → 'GLOBAL', 'hunter-exotics-003' → 'HUNTER-EXOTICS')
    // Find the domain by checking which domain has this decision
    let found = false;
    for (const [domainName, domain] of Object.entries(carl.domains || {})) {
        const decision = (domain.decisions || []).find(d => d.id === id);
        if (decision) {
            decision.status = 'archived';
            found = true;
            writeCarlJson(workspacePath, carl);
            return { id, domain: domainName, message: `Archived ${id}` };
        }
    }

    if (!found) {
        throw new Error(`Decision "${id}" not found in any domain`);
    }
}

// --- Staging handlers ---

async function stageProposal(args, workspacePath) {
    const domainName = (args.domain || '').toUpperCase();
    if (!domainName) throw new Error('Missing required parameter: domain');
    if (!args.rule_text) throw new Error('Missing required parameter: rule_text');
    if (!args.rationale) throw new Error('Missing required parameter: rationale');

    debugLog('Staging proposal for:', domainName);
    const carl = readCarlJson(workspacePath);

    if (!carl.staging) carl.staging = [];

    const id = nextStagingId(carl.staging);
    const entry = {
        id,
        source_session: null,
        proposed_domain: domainName,
        rule_text: args.rule_text,
        rationale: args.rationale,
        status: 'pending',
        created_at: new Date().toISOString(),
        reviewed_at: null
    };

    carl.staging.push(entry);
    writeCarlJson(workspacePath, carl);

    return { id, domain: domainName, message: `Staged ${id} for ${domainName}` };
}

async function getStaged(workspacePath) {
    debugLog('Getting staged proposals');
    const carl = readCarlJson(workspacePath);
    const staging = carl.staging || [];

    const pending = staging.filter(s => s.status === 'pending');
    const approved = staging.filter(s => s.status === 'approved');
    const rejected = staging.filter(s => s.status === 'rejected');

    return { pending_count: pending.length, approved_count: approved.length, rejected_count: rejected.length, pending, approved, rejected };
}

async function approveProposal(args, workspacePath) {
    const { id } = args;
    if (!id) throw new Error('Missing required parameter: id');

    debugLog('Approving proposal:', id);
    const carl = readCarlJson(workspacePath);

    if (!carl.staging) carl.staging = [];
    const idx = carl.staging.findIndex(s => s.id === id && s.status === 'pending');

    if (idx === -1) {
        throw new Error(`Pending proposal "${id}" not found`);
    }

    const proposal = carl.staging[idx];
    const domainName = proposal.proposed_domain;

    if (!carl.domains[domainName]) {
        throw new Error(`Target domain "${domainName}" not found in carl.json`);
    }

    // Add rule to target domain
    const domain = carl.domains[domainName];
    if (!domain.rules) domain.rules = [];

    const ruleId = nextRuleId(domain.rules);
    domain.rules.push({
        id: ruleId,
        text: proposal.rule_text,
        added: todayStr(),
        last_reviewed: null,
        source: 'staging'
    });

    // Remove from staging
    carl.staging.splice(idx, 1);
    writeCarlJson(workspacePath, carl);

    return { id, domain: domainName, rule_id: ruleId, message: `Approved ${id} → ${domainName} rule ${ruleId}` };
}

// --- Config handlers ---

async function getConfig(workspacePath) {
    debugLog('Getting config');
    const carl = readCarlJson(workspacePath);
    return carl.config || {};
}

async function updateConfig(args, workspacePath) {
    const { data } = args;
    if (!data) throw new Error('Missing required parameter: data');

    debugLog('Updating config');
    const carl = readCarlJson(workspacePath);

    if (!carl.config) carl.config = {};
    carl.config = { ...carl.config, ...data };
    writeCarlJson(workspacePath, carl);

    return carl.config;
}

// ============================================================
// HANDLER DISPATCH
// ============================================================

export async function handleTool(name, args, workspacePath) {
    switch (name) {
        // Domains
        case 'carl_v2_list_domains': return listDomains(workspacePath);
        case 'carl_v2_get_domain': return getDomain(args, workspacePath);
        case 'carl_v2_create_domain': return createDomain(args, workspacePath);
        case 'carl_v2_toggle_domain': return toggleDomain(args, workspacePath);
        // Rules
        case 'carl_v2_add_rule': return addRule(args, workspacePath);
        case 'carl_v2_remove_rule': return removeRule(args, workspacePath);
        case 'carl_v2_replace_rules': return replaceDomainRules(args, workspacePath);
        // Decisions
        case 'carl_v2_log_decision': return logDecision(args, workspacePath);
        case 'carl_v2_search_decisions': return searchDecisions(args, workspacePath);
        case 'carl_v2_archive_decision': return archiveDecision(args, workspacePath);
        // Staging
        case 'carl_v2_stage_proposal': return stageProposal(args, workspacePath);
        case 'carl_v2_get_staged': return getStaged(workspacePath);
        case 'carl_v2_approve_proposal': return approveProposal(args, workspacePath);
        // Config
        case 'carl_v2_get_config': return getConfig(workspacePath);
        case 'carl_v2_update_config': return updateConfig(args, workspacePath);
        default: return null;
    }
}
