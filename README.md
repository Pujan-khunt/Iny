# Iny

[![CI](https://github.com/Pujan-khunt/Iny/actions/workflows/ci.yml/badge.svg)](https://github.com/Pujan-khunt/Iny/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.0.0-green.svg)

> Iny is a universal WhatsApp assistant that brings isolated features and tools together under one interface.

## About Iny

Iny is a modular AI assistant engine. Instead of juggling multiple disconnected apps, scripts, and APIs, Iny unifies them into a single conversational interface on WhatsApp (with an interactive CLI for local development). Powered by DeepSeek LLM reasoning, Iny understands natural language requests, maintains multi-turn conversation memory, and autonomously invokes the appropriate tools to get things done.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v22.0.0 or higher)
- [npm](https://www.npmjs.com/) (v10.0.0 or higher)
- A [DeepSeek API key](https://platform.deepseek.com/)

### Installation

1. Clone the repository:
   ```bash
   git clone git@github.com:Pujan-khunt/Iny.git
   cd Iny
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```
   Open `.env` and fill in your configuration:
   - `DEEPSEEK_API_KEY`: Your DeepSeek API key (required)
   - `SYSTEM_PROMPT`: The assistant system instructions and persona (required)
   - `DEEPSEEK_MODEL`: Model identifier (defaults to `deepseek-flash`)
   - `LOG_LEVEL`: Logging verbosity (defaults to `info`)
   - `MAX_TOOL_ITERATIONS`: Maximum tool loop iterations (defaults to `5`)
   - `MAX_HISTORY_TURNS`: Number of historical dialogue turns retained in memory (defaults to `10`)

## Available Commands

- **Start interactive development mode** (with pretty-printed logs):
  ```bash
  npm run dev
  ```
- **Run the test suite** (Vitest):
  ```bash
  npm test
  ```
- **Run tests with coverage report** (V8):
  ```bash
  npm run test:coverage
  ```
- **Build for production** (TypeScript compilation):
  ```bash
  npm run build
  ```
- **Run the production build**:
  ```bash
  npm start
  ```

## Documentation

- [System Architecture](docs/ARCHITECTURE.md): Complete map of Hexagonal boundaries, ports, adapters, and sequence diagrams.
- [Agent Guidelines](AGENTS.md): Zero-trust operating contract and development lifecycle rules.

## License

This project is licensed under the [MIT License](LICENSE).
