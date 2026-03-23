<div align="center">

# CARL

**Context Augmentation & Reinforcement Layer** — Dynamic rules for Claude Code.

[![npm version](https://img.shields.io/npm/v/carl-core?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/carl-core)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/ChristopherKahler/carl?style=for-the-badge&logo=github&color=181717)](https://github.com/ChristopherKahler/carl)

<br>

```bash
npx carl-core
```

**Works on Mac, Windows, and Linux.**

<br>

![CARL Install](assets/terminal.svg?v=3)

<br>

*"Rules that load when relevant, disappear when not."*

<br>

[Why CARL](#why-carl) · [Getting Started](#getting-started) · [How It Works](#how-it-works) · [Core Concepts](#core-concepts) · [MCP Tools](#mcp-tools) · [Migration](#upgrading-from-v1)

</div>

---

## Why CARL

Every Claude Code session starts fresh. Your preferences, workflows, and hard-won lessons? Gone. You end up repeating the same instructions:

> "Use TypeScript strict mode."
> "Don't over-engineer."
> "Run tests after changes."

Static prompts in CLAUDE.md work, but they bloat every session — even when irrelevant. Writing code? You don't need your content creation rules. Debugging? You don't need your planning workflow.

CARL fixes this with **just-in-time rule injection**:

1. **Rules load when relevant** — Mention "fix bug" and your development preferences appear
2. **Rules disappear when not** — Your context stays lean
3. **Explicit triggers available** — Star-commands (`*commandname`) for on-demand modes

The result: Claude remembers how you work without wasting context on rules you don't need right now.

---

## Who This Is For

**Claude Code users** who want persistent preferences without bloated prompts.

You've figured out what works for you — coding style, response format, workflow patterns. CARL makes those preferences stick:

- Define rules once, use them forever
- Rules activate automatically based on context
- Override or extend per-project as needed
- No manual prompt engineering each session

If you find yourself repeating instructions to Claude, CARL is for you.

---

## Getting Started

```bash
npx carl-core
```

The installer prompts you to choose:
1. **Global** (recommended) — Rules apply to all Claude Code projects (`~/.claude` + `~/.carl`)
2. **Local** — Rules apply to current project only (`./.claude` + `./.carl`)

**Restart Claude Code after installation.**

### What Gets Installed

```
~/.carl/
├── carl.json              # All domains, rules, decisions, config
├── sessions/              # Session state (auto-managed)
└── carl-mcp/              # MCP server for runtime management
    ├── index.js
    ├── package.json
    └── tools/
        ├── carl-json.js   # Domain/rule/decision/config CRUD
        ├── decisions.js   # Decision logging (v1 compat)
        ├── domains.js     # Domain management (v1 compat)
        └── staging.js     # Rule proposal pipeline

~/.claude/
├── hooks/carl-hook.py     # The injection engine
└── settings.json          # Hook + MCP registration
```

### Staying Updated

```bash
npx carl-core@latest
```

---

## How It Works

```
You type: "help me fix this bug"
                │
                ▼
    ┌───────────────────────┐
    │   CARL Hook Scans     │
    │   Your Prompt         │
    └───────────────────────┘
                │
                ▼
    ┌───────────────────────┐
    │  Matches "fix bug"    │
    │  → DEVELOPMENT domain │
    └───────────────────────┘
                │
                ▼
    ┌───────────────────────┐
    │  Injects Your Rules   │
    │  Into Context         │
    └───────────────────────┘
                │
                ▼
    Claude responds with your
    coding preferences baked in
```

The hook runs on every interaction, reads your `.carl/carl.json`, and injects only the rules that match your current task.

### Architecture (v2)

Everything lives in a single `carl.json` file:

```json
{
  "version": 1,
  "config": {
    "devmode": false,
    "context_brackets": { "FRESH": {...}, "MODERATE": {...}, "DEPLETED": {...} },
    "commands": { "BRIEF": [...], "DISCUSS": [...] }
  },
  "domains": {
    "GLOBAL": { "state": "active", "always_on": true, "rules": [...], "decisions": [...] },
    "DEVELOPMENT": { "state": "active", "recall": ["fix bug", "write code"], "rules": [...] }
  },
  "staging": []
}
```

**Key design decisions:**
- **Single source of truth** — No scattered files. One JSON file holds everything.
- **MCP for runtime management** — Add rules, log decisions, toggle domains without editing files.
- **Scope merging** — Project `.carl/` extends global `~/.carl/`. More-specific overrides less-specific.
- **Context dedup** — Repeated prompts don't re-inject identical rules, saving tokens.
- **Session management** — Per-session overrides without modifying permanent config.

---

## Core Concepts

### Domains

A domain is a collection of related rules. Create domains for different contexts:

| Example Domain | Trigger Keywords | What It Does |
|----------------|------------------|--------------|
| GLOBAL | (always loaded) | Universal preferences |
| DEVELOPMENT | "fix bug", "write code" | Your coding preferences |
| CONTENT | "write script", "youtube" | Your content creation style |
| CLIENTS | "client project", "deliverable" | Project-specific rules |

When your prompt matches a domain's recall keywords, its rules load automatically.

### Star-Commands

Explicit triggers using `*commandname` syntax:

```
*brief explain recursion
```

Unlike domains (automatic), star-commands are intentional. Define them in `carl.json` under `config.commands`:

```json
"commands": {
  "BRIEF": [
    "Create a concise session report",
    "Include: goals, work completed, decisions, next steps"
  ]
}
```

### Context Brackets

Rules that adapt based on remaining context window:

| Bracket | Remaining | Behavior |
|---------|-----------|----------|
| FRESH | 70%+ | Lean injection, trust recent context |
| MODERATE | 40-70% | Reinforce key context |
| DEPLETED | 15-40% | Heavy reinforcement, checkpoint progress |
| CRITICAL | <15% | Suggest compaction |

Configured in `carl.json` under `config.context_brackets`.

### Decisions

Log important decisions alongside rules. Decisions are per-domain and injected with relevant rules:

```json
{
  "id": "dev-001",
  "decision": "Use PostgreSQL over SQLite for all new projects",
  "rationale": "Need concurrent writes and JSON support",
  "date": "2026-03-15",
  "recall": ["database", "postgres", "sqlite"]
}
```

---

## MCP Tools

CARL includes an MCP server with tools for runtime management. These are available in Claude Code once installed:

### v2 Tools (carl.json)

| Tool | Description |
|------|-------------|
| `carl_v2_list_domains` | List all domains with rule/decision counts |
| `carl_v2_get_domain` | Get full domain config and rules |
| `carl_v2_create_domain` | Create a new domain with recall keywords |
| `carl_v2_toggle_domain` | Enable/disable a domain |
| `carl_v2_add_rule` | Add a rule to a domain |
| `carl_v2_remove_rule` | Remove a rule by ID |
| `carl_v2_replace_rules` | Bulk-replace all rules in a domain |
| `carl_v2_log_decision` | Log a decision to a domain |
| `carl_v2_search_decisions` | Search decisions by keyword |
| `carl_v2_archive_decision` | Archive a decision |
| `carl_v2_stage_proposal` | Stage a rule proposal for review |
| `carl_v2_get_staged` | List pending proposals |
| `carl_v2_approve_proposal` | Approve a proposal into a domain |
| `carl_v2_get_config` | Get CARL config |
| `carl_v2_update_config` | Update config fields |

---

## Configuration

### Global vs Local

| Location | Scope | Use Case |
|----------|-------|----------|
| `~/.carl/` | All projects | Universal preferences |
| `./.carl/` | Current project | Project-specific rules |

When both exist, project-level domains override global ones. The hook walks up the directory tree, merging scopes from global to local.

### Creating a Domain

Use the MCP tools (Claude will call these for you):

```
"Create a TESTING domain with recall keywords: run tests, test coverage, write tests"
```

Or edit `carl.json` directly:

```json
"TESTING": {
  "state": "active",
  "always_on": false,
  "recall": ["run tests", "test coverage", "write tests"],
  "exclude": [],
  "rules": [
    { "id": 0, "text": "Always run the full test suite after changes", "added": "2026-03-23" }
  ],
  "decisions": []
}
```

---

## Upgrading from v1

If you have an existing v1 setup (flat files: `manifest`, domain files, `context`, `commands`):

```bash
# If installed via npm:
bash node_modules/carl-core/bin/migrate-v1-to-v2.sh --dry-run ~/.carl
bash node_modules/carl-core/bin/migrate-v1-to-v2.sh ~/.carl

# If cloned from GitHub:
bash bin/migrate-v1-to-v2.sh --dry-run ~/.carl
bash bin/migrate-v1-to-v2.sh ~/.carl
```

The migration tool:
- Parses all v1 files (manifest, domains, context brackets, star commands, decisions)
- Generates a complete `carl.json`
- Archives old files to `.carl/_v1-archive/` (non-destructive)
- Preserves all rules, decisions, and configuration

---

## CARL + PAUL

CARL has a companion: **[PAUL](https://github.com/ChristopherKahler/paul)** (Plan-Apply-Unify Loop).

| Tool | Purpose |
|------|---------|
| **CARL** | Dynamic rule injection — how Claude behaves |
| **PAUL** | Structured development workflow — how work flows |

They complement each other:

- CARL loads PAUL rules when you're in a `.paul/` project
- PAUL enforces loop integrity (plan, apply, unify)
- CARL keeps PAUL rules out of context when not needed

**Without CARL:** PAUL rules would bloat every session.
**Without PAUL:** Complex projects lack structure.

Together: lean context + reliable workflow.

---

## Troubleshooting

**Rules not loading?**
1. Check domain has `"state": "active"` in carl.json
2. Verify recall keywords match your prompt
3. Ensure hook is configured in `~/.claude/settings.json`

**Too many rules loading?**
1. Make recall keywords more specific
2. Use exclude to block unwanted matches
3. Split broad domains into focused ones

**Context dedup active?**
- CARL skips re-injecting rules when the signature hasn't changed
- Forces a full re-inject every 5 prompts
- Override with session config if needed

---

## Ecosystem

CARL is part of a broader Claude Code extension ecosystem:

| System | What It Does | Link |
|--------|-------------|------|
| **AEGIS** | Multi-agent codebase auditing — diagnosis + controlled evolution | [GitHub](https://github.com/ChristopherKahler/aegis) |
| **BASE** | Builder's Automated State Engine — workspace lifecycle, health tracking, drift prevention | [GitHub](https://github.com/ChristopherKahler/base) |
| **CARL** | Context Augmentation & Reinforcement Layer — dynamic rules loaded JIT by intent | You are here |
| **PAUL** | Project orchestration — Plan, Apply, Unify Loop | [GitHub](https://github.com/ChristopherKahler/paul) |
| **SEED** | Typed project incubator — guided ideation through graduation into buildable projects | [GitHub](https://github.com/ChristopherKahler/seed) |
| **Skillsmith** | Skill builder — standardized syntax specs + guided workflows for Claude Code skills | [GitHub](https://github.com/ChristopherKahler/skillsmith) |
| **CC Strategic AI** | Skool community — courses, community, live support | [Skool](https://skool.com/cc-strategic-ai) |

---

## Philosophy

### Lean Context

Static prompts waste tokens on irrelevant rules. CARL loads only what's needed. More room for actual work.

### Explicit Over Magic

CARL is transparent. See exactly which domains loaded, know why rules activated. No hidden behavior.

### Your Rules, Your Way

CARL provides structure, not opinions. The default domains are examples — customize or replace them entirely.

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

## Author

**Chris Kahler** — [Chris AI Systems](https://github.com/ChristopherKahler)

Building tools for AI-assisted development.

---

<div align="center">

**Claude Code is powerful. CARL makes it personal.**

</div>
