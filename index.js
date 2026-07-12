#!/usr/bin/env node

/**
 * webos-mcp — MCP server providing Palm/HP webOS development context for Claude.
 * Exposes curated knowledge files as resources so Claude understands the platform
 * without needing to be re-taught each session.
 *
 * Resources:
 *   webos://knowledge/<topic>  — individual knowledge files
 *   webos://knowledge/all      — all files concatenated (load full context at once)
 *
 * Prompts:
 *   webos-session-start        — primes Claude for a webOS dev session
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = join(__dirname, 'knowledge');

// ---------------------------------------------------------------------------
// Load all .md files from the knowledge directory at startup
// ---------------------------------------------------------------------------

function loadKnowledge() {
  const files = readdirSync(KNOWLEDGE_DIR)
    .filter(f => f.endsWith('.md'))
    .sort();

  return files.map(file => {
    const name = file.replace(/\.md$/, '');
    const content = readFileSync(join(KNOWLEDGE_DIR, file), 'utf8');

    // Derive a human-readable title from the first H1 heading, fall back to name
    const h1 = content.split('\n').find(l => l.startsWith('# '));
    const title = h1 ? h1.replace(/^#\s+/, '') : name;

    return {
      name,
      title,
      content,
      uri: `webos://knowledge/${name}`,
    };
  });
}

const knowledge = loadKnowledge();

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'webos-mcp', version: '0.1.0' },
  { capabilities: { resources: {}, prompts: {} } }
);

// ---------------------------------------------------------------------------
// Resources — list
// ---------------------------------------------------------------------------

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const individual = knowledge.map(k => ({
    uri: k.uri,
    name: k.title,
    description: `webOS knowledge: ${k.title}`,
    mimeType: 'text/markdown',
  }));

  const bundle = {
    uri: 'webos://knowledge/all',
    name: 'webOS — Full Knowledge Bundle',
    description: 'All webOS knowledge files concatenated. Use this to fully prime Claude at the start of a session.',
    mimeType: 'text/markdown',
  };

  return { resources: [bundle, ...individual] };
});

// ---------------------------------------------------------------------------
// Resources — read
// ---------------------------------------------------------------------------

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  // Bundle: concatenate all knowledge files with clear separators
  if (uri === 'webos://knowledge/all') {
    const combined = knowledge
      .map(k => `${'='.repeat(80)}\n# ${k.title}\n${'='.repeat(80)}\n\n${k.content}`)
      .join('\n\n');

    return {
      contents: [{
        uri,
        mimeType: 'text/markdown',
        text: combined,
      }],
    };
  }

  // Individual topic
  const topic = uri.replace('webos://knowledge/', '');
  const entry = knowledge.find(k => k.name === topic);

  if (!entry) {
    throw new Error(`Unknown resource: ${uri}`);
  }

  return {
    contents: [{
      uri,
      mimeType: 'text/markdown',
      text: entry.content,
    }],
  };
});

// ---------------------------------------------------------------------------
// Prompts — list
// ---------------------------------------------------------------------------

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: 'webos-session-start',
      description: 'Primes Claude with full webOS context at the start of a development session.',
    },
    {
      name: 'webos-new-app',
      description: 'Scaffolding prompt for starting a new webOS app (Mojo or Enyo).',
      arguments: [
        { name: 'framework', description: 'mojo or enyo', required: true },
        { name: 'appName', description: 'Application name / ID', required: true },
      ],
    },
  ],
}));

// ---------------------------------------------------------------------------
// Prompts — get
// ---------------------------------------------------------------------------

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'webos-session-start') {
    const bundle = knowledge
      .map(k => `## ${k.title}\n\n${k.content}`)
      .join('\n\n---\n\n');

    return {
      description: 'Full webOS development context',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `You are helping develop an application for Palm/HP webOS (the original 2009–2012 platform, not LG webOS). Please read and internalize the following platform knowledge before we begin:\n\n${bundle}\n\nConfirm you've loaded this context and are ready to help with webOS development.`,
          },
        },
      ],
    };
  }

  if (name === 'webos-new-app') {
    const framework = args?.framework || 'mojo';
    const appName = args?.appName || 'com.example.myapp';

    return {
      description: `Scaffold a new webOS ${framework} app`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Create the scaffolding for a new webOS app using the ${framework} framework. App name/ID: ${appName}. Include appinfo.json, the framework entry point, and a basic "Hello World" scene or kind. Follow the conventions from your webOS knowledge.`,
          },
        },
      ],
    };
  }

  throw new Error(`Unknown prompt: ${name}`);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
