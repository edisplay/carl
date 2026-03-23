#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# CARL v1 → v2 Migration Tool
# Converts flat-file .carl/ (manifest + domain files) to carl.json
# Non-destructive: archives old files to .carl/_v1-archive/
# ============================================================================

VERSION="2.0.0"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

print_banner() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}   CARL v1 → v2 Migration Tool                   ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}   Flat files → carl.json                         ${CYAN}║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
    echo ""
}

usage() {
    echo "Usage: migrate-v1-to-v2.sh [OPTIONS] [CARL_DIR]"
    echo ""
    echo "Arguments:"
    echo "  CARL_DIR      Path to .carl/ directory (default: ./.carl)"
    echo ""
    echo "Options:"
    echo "  --dry-run     Show what would be done without writing"
    echo "  --no-archive  Don't archive old files (just generate carl.json)"
    echo "  --help, -h    Show this help"
    echo ""
    echo "Examples:"
    echo "  migrate-v1-to-v2.sh                    # Migrate ./.carl/"
    echo "  migrate-v1-to-v2.sh ~/.carl            # Migrate global CARL"
    echo "  migrate-v1-to-v2.sh --dry-run ~/.carl  # Preview migration"
}

# Parse arguments
DRY_RUN=false
NO_ARCHIVE=false
CARL_DIR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --no-archive)
            NO_ARCHIVE=true
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            CARL_DIR="$1"
            shift
            ;;
    esac
done

# Default to ./.carl if not specified
if [[ -z "$CARL_DIR" ]]; then
    CARL_DIR="./.carl"
fi

# Resolve to absolute path
CARL_DIR="$(cd "$CARL_DIR" 2>/dev/null && pwd)" || {
    echo -e "${RED}Error: Directory not found: $CARL_DIR${NC}"
    exit 1
}

print_banner

# Check prerequisites
if ! command -v python3 &>/dev/null; then
    echo -e "${RED}Error: python3 is required for migration${NC}"
    exit 1
fi

# Verify this is a v1 setup
if [[ -f "$CARL_DIR/carl.json" ]]; then
    echo -e "${YELLOW}Warning: carl.json already exists at $CARL_DIR/carl.json${NC}"
    echo -e "${YELLOW}This may already be a v2 setup. Continue anyway? (y/N)${NC}"
    read -r confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        echo "Aborted."
        exit 0
    fi
fi

if [[ ! -f "$CARL_DIR/manifest" ]]; then
    echo -e "${RED}Error: No manifest file found at $CARL_DIR/manifest${NC}"
    echo -e "${RED}This doesn't appear to be a v1 CARL setup.${NC}"
    exit 1
fi

echo -e "${GREEN}Found v1 CARL at: $CARL_DIR${NC}"
echo ""

# Run the Python migration
python3 - "$CARL_DIR" "$DRY_RUN" "$NO_ARCHIVE" << 'PYTHON_SCRIPT'
import json
import os
import sys
import shutil
import re
from pathlib import Path
from datetime import datetime

carl_dir = Path(sys.argv[1])
dry_run = sys.argv[2] == "true"
no_archive = sys.argv[3] == "true"

def log(msg, color=""):
    colors = {"green": "\033[0;32m", "yellow": "\033[1;33m", "cyan": "\033[0;36m", "red": "\033[0;31m"}
    nc = "\033[0m"
    prefix = colors.get(color, "")
    print(f"{prefix}{msg}{nc}")


def parse_manifest(filepath):
    """Parse manifest file into domain configs and global settings."""
    domains = {}
    devmode = False
    post_compact_gate = True
    global_exclude = []

    with open(filepath, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            key = key.strip()
            value = value.strip()

            if key == 'DEVMODE':
                devmode = value.lower() in ('true', 'yes', '1')
                continue
            if key == 'POST_COMPACT_GATE':
                post_compact_gate = value.lower() in ('true', 'yes', '1')
                continue
            if key == 'GLOBAL_EXCLUDE':
                global_exclude = [k.strip() for k in value.split(',') if k.strip()]
                continue

            # Domain entries: DOMAIN_STATE, DOMAIN_ALWAYS_ON, DOMAIN_RECALL, DOMAIN_EXCLUDE
            for suffix in ['_STATE', '_ALWAYS_ON', '_RECALL', '_EXCLUDE']:
                if key.endswith(suffix):
                    domain_name = key[:-len(suffix)]
                    if domain_name not in domains:
                        domains[domain_name] = {}
                    field = suffix[1:].lower()
                    domains[domain_name][field] = value
                    break

    return domains, devmode, post_compact_gate, global_exclude


def parse_domain_rules(filepath, domain_name):
    """Parse a domain file for rules with metadata."""
    rules = []
    if not filepath.exists():
        return rules

    with open(filepath, 'r') as f:
        lines = f.readlines()

    prefix = f"{domain_name}_RULE_"
    pending_meta = {"added": None, "last_reviewed": None, "source": "manual"}

    for line in lines:
        line = line.strip()

        # Capture metadata from comments above rules
        if line.startswith('# Rule added:'):
            pending_meta['added'] = line.split(':', 1)[1].strip()
        elif line.startswith('# Last reviewed:'):
            val = line.split(':', 1)[1].strip()
            pending_meta['last_reviewed'] = val if val and val != 'null' else None
        elif line.startswith('# Source:'):
            pending_meta['source'] = line.split(':', 1)[1].strip()
        elif '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            key = key.strip()
            if key.startswith(prefix):
                try:
                    rule_id = int(key[len(prefix):])
                except ValueError:
                    continue
                rules.append({
                    "id": rule_id,
                    "text": value.strip(),
                    "added": pending_meta.get('added'),
                    "last_reviewed": pending_meta.get('last_reviewed'),
                    "source": pending_meta.get('source', 'manual')
                })
                pending_meta = {"added": None, "last_reviewed": None, "source": "manual"}

    rules.sort(key=lambda r: r['id'])
    return rules


def parse_context_file(filepath):
    """Parse context file into bracket rules."""
    brackets = {}
    if not filepath.exists():
        return brackets

    with open(filepath, 'r') as f:
        lines = f.readlines()

    current_bracket = None
    for line in lines:
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip()

        # FRESH_RULES=true/false → bracket enabled flag
        if key.endswith('_RULES') and not key.endswith('_RULE_'):
            bracket_name = key[:-6]
            if bracket_name not in brackets:
                brackets[bracket_name] = {"enabled": True, "rules": []}
            brackets[bracket_name]["enabled"] = value.lower() in ('true', 'yes', '1')
            current_bracket = bracket_name
            continue

        # FRESH_RULE_1=text → bracket rule
        for bracket_name in ['FRESH', 'MODERATE', 'DEPLETED', 'CRITICAL']:
            rule_prefix = f"{bracket_name}_RULE_"
            if key.startswith(rule_prefix):
                if bracket_name not in brackets:
                    brackets[bracket_name] = {"enabled": True, "rules": []}
                brackets[bracket_name]["rules"].append(value)
                break

    return brackets


def parse_commands_file(filepath):
    """Parse commands file into star commands dict."""
    commands = {}
    if not filepath.exists():
        return commands

    with open(filepath, 'r') as f:
        lines = f.readlines()

    for line in lines:
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip()

        # FOCUS_RULE_0=text → command FOCUS, rule text
        match = re.match(r'^([A-Z_]+)_RULE_\d+$', key)
        if match:
            cmd_name = match.group(1)
            if cmd_name not in commands:
                commands[cmd_name] = []
            commands[cmd_name].append(value)

    return commands


def load_decisions(decisions_dir):
    """Load all decision files from decisions/ directory."""
    domain_decisions = {}
    if not decisions_dir.exists():
        return domain_decisions

    for filepath in decisions_dir.glob('*.json'):
        domain_name = filepath.stem.upper()
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)

            active = []
            for d in data.get('decisions', []):
                active.append({
                    "id": d.get('id', ''),
                    "decision": d.get('decision', ''),
                    "rationale": d.get('rationale', ''),
                    "date": d.get('date', ''),
                    "source": d.get('source', 'manual'),
                    "recall": d.get('recall', []),
                    "status": "active"
                })
            for d in data.get('archived', []):
                active.append({
                    "id": d.get('id', ''),
                    "decision": d.get('decision', ''),
                    "rationale": d.get('rationale', ''),
                    "date": d.get('date', ''),
                    "source": d.get('source', 'manual'),
                    "recall": d.get('recall', []),
                    "status": "archived"
                })

            if active:
                domain_decisions[domain_name] = active

        except (json.JSONDecodeError, IOError) as e:
            log(f"  Warning: Could not read {filepath}: {e}", "yellow")

    return domain_decisions


# ============================================================================
# MAIN MIGRATION
# ============================================================================

log("Scanning v1 files...", "cyan")

# 1. Parse manifest
manifest_path = carl_dir / 'manifest'
domain_configs, devmode, post_compact_gate, global_exclude = parse_manifest(manifest_path)
log(f"  Manifest: {len(domain_configs)} domains, devmode={devmode}")

# 2. Parse domain files
domain_rules = {}
skip_files = {'manifest', 'context', 'commands', 'carl.json', 'sessions', 'decisions',
              '_v1-archive', 'archive', 'carl-mcp', 'skool', 'psmm.json', 'staging.json'}

for item in carl_dir.iterdir():
    if item.is_file() and not item.is_dir() and item.name not in skip_files and not item.name.startswith('.'):
        domain_name = item.name.upper()
        if domain_name.endswith('.JSON') or domain_name.endswith('.ENV') or domain_name.endswith('.MD'):
            continue
        rules = parse_domain_rules(item, domain_name)
        if rules:
            domain_rules[domain_name] = rules
            log(f"  Domain {domain_name}: {len(rules)} rules")

# Also check for domain names from manifest that might have lowercase files
for domain_name in domain_configs:
    if domain_name not in domain_rules:
        lower_path = carl_dir / domain_name.lower()
        if lower_path.exists() and lower_path.is_file():
            rules = parse_domain_rules(lower_path, domain_name)
            if rules:
                domain_rules[domain_name] = rules
                log(f"  Domain {domain_name}: {len(rules)} rules")

# 3. Parse context file
context_path = carl_dir / 'context'
context_brackets = parse_context_file(context_path)
if context_brackets:
    total_rules = sum(len(b['rules']) for b in context_brackets.values())
    log(f"  Context: {len(context_brackets)} brackets, {total_rules} rules")

# 4. Parse commands file
commands_path = carl_dir / 'commands'
commands = parse_commands_file(commands_path)
if commands:
    total_cmd_rules = sum(len(r) for r in commands.values())
    log(f"  Commands: {len(commands)} star commands, {total_cmd_rules} rules")

# 5. Load decisions
decisions_dir = carl_dir / 'decisions'
domain_decisions = load_decisions(decisions_dir)
if domain_decisions:
    total_decisions = sum(len(d) for d in domain_decisions.values())
    log(f"  Decisions: {len(domain_decisions)} domains, {total_decisions} entries")

# 6. Build carl.json
log("\nBuilding carl.json...", "cyan")

carl_json = {
    "version": 1,
    "last_modified": datetime.now().isoformat(),
    "config": {
        "devmode": devmode,
        "post_compact_gate": post_compact_gate,
        "global_exclude": global_exclude,
        "context_brackets": context_brackets if context_brackets else {},
        "commands": commands if commands else {}
    },
    "domains": {},
    "staging": []
}

# Build domain entries
all_domain_names = set(list(domain_configs.keys()) + list(domain_rules.keys()))
for domain_name in sorted(all_domain_names):
    config = domain_configs.get(domain_name, {})

    state_val = config.get('state', 'active')
    state = 'active' if state_val.lower() in ('active', 'true', 'yes', '1') else 'inactive'

    always_on_val = config.get('always_on', 'false')
    always_on = always_on_val.lower() in ('true', 'yes', '1')

    recall_val = config.get('recall', '')
    recall = [k.strip() for k in recall_val.split(',') if k.strip()] if recall_val else []

    exclude_val = config.get('exclude', '')
    exclude = [k.strip() for k in exclude_val.split(',') if k.strip()] if exclude_val else []

    rules = domain_rules.get(domain_name, [])
    decisions = domain_decisions.get(domain_name, [])

    carl_json["domains"][domain_name] = {
        "state": state,
        "always_on": always_on,
        "recall": recall,
        "exclude": exclude,
        "rules": rules,
        "decisions": decisions
    }

    log(f"  {domain_name}: {len(rules)} rules, {len(decisions)} decisions, state={state}, always_on={always_on}")

# Summary
total_rules = sum(len(d.get('rules', [])) for d in carl_json['domains'].values())
total_decisions = sum(len(d.get('decisions', [])) for d in carl_json['domains'].values())
log(f"\nTotal: {len(carl_json['domains'])} domains, {total_rules} rules, {total_decisions} decisions", "green")

if dry_run:
    log("\n[DRY RUN] Would write carl.json with above contents", "yellow")
    log(f"[DRY RUN] Would archive v1 files to {carl_dir}/_v1-archive/", "yellow")
    # Print a preview of the JSON structure (keys only)
    print(json.dumps(carl_json, indent=2)[:2000])
    if len(json.dumps(carl_json)) > 2000:
        print("... (truncated)")
    sys.exit(0)

# 7. Archive old files
if not no_archive:
    archive_dir = carl_dir / '_v1-archive'
    archive_dir.mkdir(exist_ok=True)

    v1_files = ['manifest', 'context', 'commands']
    # Also archive domain flat files
    for item in carl_dir.iterdir():
        if item.is_file() and item.name not in skip_files and not item.name.startswith('.'):
            if not item.name.endswith('.json') and not item.name.endswith('.env'):
                v1_files.append(item.name)

    for fname in v1_files:
        src = carl_dir / fname
        if src.exists():
            dst = archive_dir / fname
            shutil.copy2(str(src), str(dst))
            src.unlink()
            log(f"  Archived: {fname} → _v1-archive/{fname}")

    # Archive decisions directory
    if decisions_dir.exists():
        archive_decisions = archive_dir / 'decisions'
        if archive_decisions.exists():
            shutil.rmtree(str(archive_decisions))
        shutil.copytree(str(decisions_dir), str(archive_decisions))
        shutil.rmtree(str(decisions_dir))
        log(f"  Archived: decisions/ → _v1-archive/decisions/")

# 8. Write carl.json
output_path = carl_dir / 'carl.json'
with open(output_path, 'w') as f:
    json.dump(carl_json, f, indent=2)

log(f"\n✓ carl.json written to {output_path}", "green")
log(f"  File size: {output_path.stat().st_size:,} bytes", "green")

if not no_archive:
    log(f"  Old files archived to: {carl_dir}/_v1-archive/", "green")

log("\nMigration complete!", "green")
log("Next steps:", "cyan")
log("  1. Update hook path in ~/.claude/settings.json to point to v2 hook")
log("  2. Verify CARL loads correctly: start a new Claude Code session")
log("  3. If issues: restore from _v1-archive/ and report a bug")

PYTHON_SCRIPT

echo ""
echo -e "${GREEN}Done.${NC}"
