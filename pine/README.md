# Pine helper indicator

`mcp-helper.pine` is a Pine v5 indicator the user installs once into TradingView. It emits Volume Profile and TPO data as tables with magic headers (`MCP_VP_v1`, `MCP_TPO_v1`) so the MCP server can parse them via `data_get_pine_tables`.

## Manual install

1. Open Pine editor in TradingView Desktop.
2. Paste contents of `mcp-helper.pine`.
3. Save with name `TV-MCP Helper`.
4. Add to chart.

## Programmatic install

Run from project root once TradingView is running:

```bash
node src/cli/index.js premium install-helper
```

This bootstrap injects the source via `pine_set_source`, compiles, saves, and adds to chart.
