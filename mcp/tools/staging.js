/**
 * CARL Staging — Rule proposal staging pipeline (legacy v1 file-based)
 * Stage, review, approve/kill rule proposals before they become CARL rules
 *
 * Note: v2 users should use carl_v2_stage_proposal / carl_v2_approve_proposal
 * from carl-json.js, which stages directly in carl.json.
 * This file provides backward compatibility for v1 flat-file setups.
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const VALID_SOURCES = ['psmm', 'decisions', 'manual'];

function debugLog(...args) {
    console.error('[CARL:staging]', new Date().toISOString(), ...args);
}

function getStagingPath(workspacePath) {
    return join(workspacePath, '.carl', 'staging.json');
}

function readStaging(workspacePath) {
    const filepath = getStagingPath(workspacePath);
    if (!existsSync(filepath)) {
        return { proposals: [] };
    }
    try {
        return JSON.parse(readFileSync(filepath, 'utf-8'));
    } catch (error) {
        debugLog('Error reading staging.json:', error.message);
        return { proposals: [] };
    }
}

function writeStaging(workspacePath, data) {
    const filepath = getStagingPath(workspacePath);
    const dir = dirname(filepath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

function nextProposalId(proposals) {
    if (proposals.length === 0) return 'prop-001';
    const nums = proposals.map(p => parseInt(p.id.replace('prop-', ''), 10)).filter(n => !isNaN(n));
    const max = nums.length > 0 ? Math.max(...nums) : 0;
    return `prop-${String(max + 1).padStart(3, '0')}`;
}

// ============================================================
// TOOL DEFINITIONS
// ============================================================

export const TOOLS = [
    {
        name: "carl_stage_proposal",
        description: "Stage a new CARL rule proposal for review. Sources: psmm, decisions, manual.",
        inputSchema: {
            type: "object",
            properties: {
                domain: { type: "string", description: "Target domain (e.g., 'GLOBAL', 'DEVELOPMENT')" },
                rule_text: { type: "string", description: "The proposed rule text" },
                rationale: { type: "string", description: "Why this rule should exist" },
                source: { type: "string", enum: VALID_SOURCES, description: "Where this proposal came from" }
            },
            required: ["domain", "rule_text", "rationale", "source"]
        }
    },
    {
        name: "carl_get_staged",
        description: "List all pending rule proposals in the staging pipeline.",
        inputSchema: { type: "object", properties: {} }
    },
    {
        name: "carl_approve_proposal",
        description: "Approve a staged proposal — writes the rule to the target domain file and removes from staging.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Proposal ID (e.g., 'prop-001')" }
            },
            required: ["id"]
        }
    },
    {
        name: "carl_kill_proposal",
        description: "Delete a staged proposal permanently.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Proposal ID to delete" }
            },
            required: ["id"]
        }
    },
    {
        name: "carl_archive_proposal",
        description: "Archive a proposal — keeps it for reference but doesn't activate as a rule.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Proposal ID to archive" }
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
        case "carl_stage_proposal": return stageProposal(args, workspacePath);
        case "carl_get_staged": return getStaged(workspacePath);
        case "carl_approve_proposal": return approveProposal(args, workspacePath);
        case "carl_kill_proposal": return killProposal(args, workspacePath);
        case "carl_archive_proposal": return archiveProposal(args, workspacePath);
        default: return null;
    }
}

async function stageProposal(args, workspacePath) {
    const { domain, rule_text, rationale, source } = args;

    if (!VALID_SOURCES.includes(source)) {
        return { success: false, error: `Invalid source: ${source}. Valid: ${VALID_SOURCES.join(', ')}` };
    }

    debugLog('Staging proposal for domain:', domain);

    const data = readStaging(workspacePath);
    const id = nextProposalId(data.proposals);
    const date = new Date().toISOString().split('T')[0];

    const proposal = {
        id,
        proposed: date,
        source,
        domain: domain.toUpperCase(),
        rule_text,
        rationale,
        status: 'pending'
    };

    data.proposals.push(proposal);
    writeStaging(workspacePath, data);

    return {
        success: true,
        id,
        domain: proposal.domain,
        message: `Staged ${id} for ${proposal.domain}: "${rule_text.slice(0, 60)}..."`
    };
}

async function getStaged(workspacePath) {
    debugLog('Getting staged proposals');
    const data = readStaging(workspacePath);

    const pending = data.proposals.filter(p => p.status === 'pending');
    const archived = data.proposals.filter(p => p.status === 'archived');

    return {
        success: true,
        pending_count: pending.length,
        archived_count: archived.length,
        pending,
        archived
    };
}

async function approveProposal(args, workspacePath) {
    const { id } = args;
    debugLog('Approving proposal:', id);

    const data = readStaging(workspacePath);
    const idx = data.proposals.findIndex(p => p.id === id && p.status === 'pending');

    if (idx === -1) {
        return { success: false, error: `Pending proposal not found: ${id}` };
    }

    const proposal = data.proposals[idx];
    const domain = proposal.domain;
    const domainLower = domain.toLowerCase();

    // Find the domain file
    const domainFilePath = join(workspacePath, '.carl', domainLower);

    if (!existsSync(domainFilePath)) {
        return { success: false, error: `Domain file not found: .carl/${domainLower}` };
    }

    // Read domain file and find next rule number
    const content = readFileSync(domainFilePath, 'utf-8');
    const ruleRegex = new RegExp(`${domain}_RULE_(\\d+)`, 'g');
    const ruleNums = [...content.matchAll(ruleRegex)].map(m => parseInt(m[1], 10));
    const nextNum = ruleNums.length > 0 ? Math.max(...ruleNums) + 1 : 1;

    // Append the new rule
    const ruleLine = `${domain}_RULE_${nextNum}=${proposal.rule_text}\n`;
    appendFileSync(domainFilePath, ruleLine, 'utf-8');

    // Remove from staging
    data.proposals.splice(idx, 1);
    writeStaging(workspacePath, data);

    return {
        success: true,
        id,
        domain,
        rule_number: nextNum,
        message: `Approved ${id} → ${domain}_RULE_${nextNum} written to .carl/${domainLower}`
    };
}

async function killProposal(args, workspacePath) {
    const { id } = args;
    debugLog('Killing proposal:', id);

    const data = readStaging(workspacePath);
    const idx = data.proposals.findIndex(p => p.id === id);

    if (idx === -1) {
        return { success: false, error: `Proposal not found: ${id}` };
    }

    data.proposals.splice(idx, 1);
    writeStaging(workspacePath, data);

    return { success: true, message: `Deleted proposal ${id}` };
}

async function archiveProposal(args, workspacePath) {
    const { id } = args;
    debugLog('Archiving proposal:', id);

    const data = readStaging(workspacePath);
    const proposal = data.proposals.find(p => p.id === id && p.status === 'pending');

    if (!proposal) {
        return { success: false, error: `Pending proposal not found: ${id}` };
    }

    proposal.status = 'archived';
    proposal.archived_date = new Date().toISOString().split('T')[0];
    writeStaging(workspacePath, data);

    return { success: true, message: `Archived proposal ${id}` };
}
