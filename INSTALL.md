# CARL Installation Guide

## Quick Install (Recommended)

```bash
npx carl-core
```

The installer will:
1. Prompt for install location (global or local)
2. Copy the v2 hook and wire it into settings.json
3. Create `.carl/carl.json` with starter domains
4. Install the MCP server to `.carl/carl-mcp/`
5. Wire the MCP server into settings.json
6. Optionally add the CARL integration block to CLAUDE.md

### Non-interactive Install

```bash
npx carl-core --global       # Install to ~/.claude and ~/.carl
npx carl-core --local        # Install to ./.claude and ./.carl
npx carl-core --skip-claude-md  # Don't modify CLAUDE.md
```

### Staying Updated

```bash
npx carl-core@latest
```

---

## Prerequisites

- Claude Code CLI installed
- Python 3.9+ (for the hook script — stdlib only, no pip deps)
- Node.js 16.7+ (for npx and MCP server)

---

## Manual Installation

If you prefer manual setup or npx isn't available:

### Step 1: Clone the Repository

```bash
git clone https://github.com/ChristopherKahler/carl.git
cd carl
```

### Step 2: Copy Hook Script

```bash
mkdir -p ~/.claude/hooks
cp hooks/carl-hook.py ~/.claude/hooks/carl-hook.py
chmod +x ~/.claude/hooks/carl-hook.py
```

### Step 3: Create CARL Config

```bash
cp -r .carl-template ~/.carl
```

This creates `~/.carl/carl.json` with starter GLOBAL and DEVELOPMENT domains.

### Step 4: Install MCP Server

```bash
cp -r mcp ~/.carl/carl-mcp
cd ~/.carl/carl-mcp && npm install
```

### Step 5: Configure Hook in settings.json

Edit `~/.claude/settings.json` (create if it doesn't exist):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 /home/YOUR_USERNAME/.claude/hooks/carl-hook.py"
          }
        ]
      }
    ]
  },
  "mcpServers": {
    "carl-mcp": {
      "command": "node",
      "args": ["/home/YOUR_USERNAME/.carl/carl-mcp/index.js"]
    }
  }
}
```

**Replace `/home/YOUR_USERNAME` with your actual home directory path.**

### Step 6: Add CARL Block to CLAUDE.md (Optional)

Add this near the top of your CLAUDE.md:

```markdown
<!-- CARL-MANAGED: Do not remove this section -->
## CARL Integration

Follow all rules in <carl-rules> blocks from system-reminders.
These are dynamically injected based on context and MUST be obeyed.
<!-- END CARL-MANAGED -->
```

---

## Upgrading from v1

If you have an existing v1 setup (flat files: manifest, domain files, context, commands):

```bash
# Preview what will be migrated
npx carl-core  # Install v2 first
bash node_modules/carl-core/bin/migrate-v1-to-v2.sh --dry-run ~/.carl

# Run migration (archives old files, generates carl.json)
bash node_modules/carl-core/bin/migrate-v1-to-v2.sh ~/.carl
```

The migration tool is non-destructive — old files are archived to `.carl/_v1-archive/`.

---

## Verify Installation

All of these should exist:

```
~/.claude/hooks/carl-hook.py         # v2 hook
~/.claude/settings.json              # Hook + MCP configured
~/.carl/carl.json                    # Domain rules and config
~/.carl/carl-mcp/index.js           # MCP server
~/.carl/carl-mcp/node_modules/      # MCP dependencies
```

---

## Usage

**Restart Claude Code** after installation.

CARL activates automatically. Your rules inject based on prompt keywords. Use MCP tools (`carl_v2_*`) to manage domains and rules at runtime.

---

## Troubleshooting

**Rules not appearing?**
- Check domain has `"state": "active"` in `carl.json`
- Verify recall keywords match your prompt
- Ensure hook path in settings.json is absolute
- Set `"devmode": true` in carl.json config for debug output

**Hook errors?**
- Ensure Python 3.9+ is installed and in PATH
- Check file permissions: `chmod +x ~/.claude/hooks/carl-hook.py`

**MCP not connecting?**
- Verify `~/.carl/carl-mcp/node_modules/` exists (run `npm install` if not)
- Check MCP entry in settings.json points to correct absolute path
- Restart Claude Code after configuration changes
