#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server } from "./McpServer.js";

// Side-effect imports: each module registers its prompts/tools on the server
import "./prompt-controller-service/prompt-controller-service.js";
import "./tools/tools-email.js";
import "./tools/tools-spreadsheet.js";
import "./tools/tools-calendar.js";

const main = async (): Promise<void> => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Assistant MCP Server running on stdio");
};

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
