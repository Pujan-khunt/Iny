# iny-db MCP Plugin

This workspace plugin integrates the `@microsoft/postgres-mcp` Model Context Protocol (MCP) server with Antigravity CLI to grant agents direct autonomous access to the `iny-db` PostgreSQL container.

## Features

- **Read Queries:** `postgres_mcp_query`
- **Mutations & DDL:** `postgres_mcp_modify`
- **Schema Introspection:** `postgres_mcp_db_context`
- **Bulk CSV Ingestion:** `postgres_mcp_bulk_load_csv`

## Requirements

- Docker container `iny-db` running PostgreSQL 16 on `127.0.0.1:5432`.
- Node.js 22+ with `npx`.
