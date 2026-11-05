# Iny PostgreSQL Database MCP Rules

## 1. Scope & Target Architecture

This plugin connects Antigravity directly to the local Docker database container:
- **Container Name:** `iny-db`
- **Host Endpoint:** `127.0.0.1:5432`
- **Database:** `iny`
- **Role:** `postgres`
- **MCP Server Name:** `iny-db`

## 2. Tool Usage Guidelines

When interacting with the database, use the appropriate MCP tools:

- **Read Queries:** Use `postgres_mcp_query` for `SELECT` operations, verification queries, and read-only diagnostics.
- **Mutations & Schema Changes:** Use `postgres_mcp_modify` for DDL (`CREATE`, `ALTER`, `DROP`) and DML (`INSERT`, `UPDATE`, `DELETE`) operations.
- **Schema Discovery:** Use `postgres_mcp_db_context` to inspect table schemas, column types, and constraints before formulating SQL queries.
- **Connection Management:** If multiple profiles exist or reconnecting is necessary, verify profiles with `postgres_mcp_list_connection_profiles` and connect via `postgres_mcp_connect`.

## 3. Autonomous Execution Guardrails

1. **Schema Verification First:** Never guess table structures or column types. Always inspect schema with `postgres_mcp_db_context` or querying `information_schema` before executing schema modifications or data ingestions.
2. **Data Safety:** Never execute unconditional `DROP TABLE`, `TRUNCATE`, or destructive batch updates unless explicitly required by the task.
3. **Transaction Discipline:** Keep modifications scoped and verify results with a subsequent `postgres_mcp_query`.
