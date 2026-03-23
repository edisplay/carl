/**
 * CARL Decisions — Per-domain decision logging/recall tools
 * Reads/writes .carl/decisions/{domain}.json files
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

function debugLog(...args) {
    console.error('[CARL:decisions]', new Date().toISOString(), ...args);
}

function getDecisionsDir(workspacePath) {
    return join(workspacePath, '.carl', 'decisions');
}

function getDomainFilePath(workspacePath, domain) {
    return join(getDecisionsDir(workspacePath), `${domain.toLowerCase()}.json`);
}

function readDomainDecisions(workspacePath, domain) {
    const filepath = getDomainFilePath(workspacePath, domain);
    if (!existsSync(filepath)) {
        return { domain: domain.toLowerCase(), decisions: [], archived: [] };
    }
    try {
        return JSON.parse(readFileSync(filepath, 'utf-8'));
    } catch (error) {
        debugLog('Error reading domain decisions:', error.message);
        return { domain: domain.toLowerCase(), decisions: [], archived: [] };
    }
}

function writeDomainDecisions(workspacePath, domain, data) {
    const filepath = getDomainFilePath(workspacePath, domain);
    writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

function listAllDomainFiles(workspacePath) {
    const dir = getDecisionsDir(workspacePath);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
}

function nextDecisionId(domain, decisions) {
    const prefix = `${domain.toLowerCase()}-`;
    const nums = decisions
        .map(d => {
            const m = d.id.match(new RegExp(`^${prefix}(\\d+)$`));
            return m ? parseInt(m[1], 10) : 0;
        })
        .filter(n => n > 0);
    const max = nums.length > 0 ? Math.max(...nums) : 0;
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

// ============================================================
// TOOL DEFINITIONS
// ============================================================

export const TOOLS = [
    {
        name: "carl_log_decision",
        description: "Log a decision to a CARL domain. Auto-creates domain file if new.",
        inputSchema: {
            type: "object",
            properties: {
                domain: { type: "string", description: "Domain name (e.g., 'casegate', 'development', 'global')" },
                decision: { type: "string", description: "The decision made" },
                rationale: { type: "string", description: "Why this decision was made" },
                recall: { type: "string", description: "Comma-separated keywords for when to recall this decision" }
            },
            required: ["domain", "decision", "rationale", "recall"]
        }
    },
    {
        name: "carl_list_decision_domains",
        description: "List all decision domain files with counts.",
        inputSchema: { type: "object", properties: {} }
    },
    {
        name: "carl_get_decisions",
        description: "Get all decisions for a domain.",
        inputSchema: {
            type: "object",
            properties: {
                domain: { type: "string", description: "Domain name (e.g., 'casegate', 'development')" }
            },
            required: ["domain"]
        }
    },
    {
        name: "carl_search_decisions",
        description: "Search decisions by keyword across all domain files.",
        inputSchema: {
            type: "object",
            properties: {
                keyword: { type: "string", description: "Keyword to search for" }
            },
            required: ["keyword"]
        }
    },
    {
        name: "carl_archive_decision",
        description: "Move a decision to the archived array in its domain file.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Decision ID (e.g., 'casegate-003')" }
            },
            required: ["id"]
        }
    }
];

// ============================================================
// TOOL HANDLERS
// ============================================================

export async function handleTool(name, args, workspacePath) {
    switch (name) {
        case "carl_log_decision": return logDecision(args, workspacePath);
        case "carl_list_decision_domains": return listDecisionDomains(workspacePath);
        case "carl_get_decisions": return getDecisions(args, workspacePath);
        case "carl_search_decisions": return searchDecisions(args, workspacePath);
        case "carl_archive_decision": return archiveDecision(args, workspacePath);
        default: return null;
    }
}

async function logDecision(args, workspacePath) {
    const { domain, decision, rationale, recall } = args;
    const domainLower = domain.toLowerCase();
    debugLog('Logging decision to domain:', domainLower);

    const data = readDomainDecisions(workspacePath, domainLower);
    const id = nextDecisionId(domainLower, data.decisions);
    const date = new Date().toISOString().split('T')[0];
    const recallList = recall.split(',').map(k => k.trim()).filter(Boolean);

    const entry = {
        id,
        decision,
        rationale,
        date,
        source: "manual",
        recall: recallList
    };

    data.decisions.push(entry);
    data.domain = domainLower;
    if (!data.archived) data.archived = [];
    writeDomainDecisions(workspacePath, domainLower, data);

    return {
        success: true,
        id,
        domain: domainLower,
        message: `Logged: ${id} to ${domainLower}`
    };
}

async function listDecisionDomains(workspacePath) {
    debugLog('Listing decision domains');
    const domainNames = listAllDomainFiles(workspacePath);
    const domains = [];

    for (const name of domainNames) {
        const data = readDomainDecisions(workspacePath, name);
        domains.push({
            domain: name,
            active_count: data.decisions.length,
            archived_count: (data.archived || []).length
        });
    }

    const totalActive = domains.reduce((sum, d) => sum + d.active_count, 0);
    const totalArchived = domains.reduce((sum, d) => sum + d.archived_count, 0);

    return {
        success: true,
        domain_count: domains.length,
        total_active: totalActive,
        total_archived: totalArchived,
        domains
    };
}

async function getDecisions(args, workspacePath) {
    const { domain } = args;
    const domainLower = domain.toLowerCase();
    debugLog('Getting decisions for:', domainLower);

    const filepath = getDomainFilePath(workspacePath, domainLower);
    if (!existsSync(filepath)) {
        return { error: `No decisions file for domain: ${domainLower}` };
    }

    const data = readDomainDecisions(workspacePath, domainLower);

    return {
        domain: domainLower,
        count: data.decisions.length,
        archived_count: (data.archived || []).length,
        decisions: data.decisions,
        archived: data.archived || []
    };
}

async function searchDecisions(args, workspacePath) {
    const { keyword } = args;
    debugLog('Searching for:', keyword);

    const lowerKeyword = keyword.toLowerCase();
    const domainNames = listAllDomainFiles(workspacePath);
    const results = [];

    for (const name of domainNames) {
        const data = readDomainDecisions(workspacePath, name);
        for (const d of data.decisions) {
            const searchText = [
                d.decision,
                d.rationale,
                ...(d.recall || [])
            ].join(' ').toLowerCase();

            if (searchText.includes(lowerKeyword)) {
                results.push({ ...d, domain: name });
            }
        }
    }

    return { keyword, count: results.length, decisions: results };
}

async function archiveDecision(args, workspacePath) {
    const { id } = args;
    debugLog('Archiving:', id);

    // Extract domain from ID (e.g., 'casegate-003' -> 'casegate')
    const dashIdx = id.lastIndexOf('-');
    if (dashIdx === -1) {
        return { error: `Invalid decision ID format: ${id}. Expected: {domain}-{number}` };
    }
    const domainLower = id.slice(0, dashIdx);

    const filepath = getDomainFilePath(workspacePath, domainLower);
    if (!existsSync(filepath)) {
        return { error: `No decisions file for domain: ${domainLower}` };
    }

    const data = readDomainDecisions(workspacePath, domainLower);
    const idx = data.decisions.findIndex(d => d.id === id);

    if (idx === -1) {
        return { error: `Decision not found: ${id}` };
    }

    const decision = data.decisions.splice(idx, 1)[0];
    decision.archived_date = new Date().toISOString().split('T')[0];

    if (!data.archived) data.archived = [];
    data.archived.push(decision);
    writeDomainDecisions(workspacePath, domainLower, data);

    return { success: true, message: `Archived: ${id}` };
}
