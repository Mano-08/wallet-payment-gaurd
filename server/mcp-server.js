import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const HTTP_SERVER_URL = process.env.HTTP_SERVER_URL || "http://localhost:3000";

const server = new McpServer({
  name: "wordpress-mcp",
  version: "1.0.1",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Universal proxy tool that can execute any dynamically created tool
server.tool(
  "execute-dynamic-tool",
  "Execute any dynamically created tool by name with optional parameters",
  {
    toolName: z.string().describe("The name of the dynamic tool to execute"),
    parameters: z
      .string()
      .optional()
      .describe("Optional parameters for the tool (JSON string)"),
  },
  async ({ toolName, parameters }) => {
    try {
      // First, get the list of available tools
      const toolsResponse = await fetch(`${HTTP_SERVER_URL}/api/tools`);

      if (!toolsResponse.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Could not connect to HTTP server at ${HTTP_SERVER_URL}`,
            },
          ],
        };
      }

      const availableTools = await toolsResponse.json();
      const tool = availableTools.find((t) => t.name === toolName);

      if (!tool) {
        const toolsList = availableTools
          .map((t) => `• ${t.name}: ${t.description}`)
          .join("\n");
        return {
          content: [
            {
              type: "text",
              text: `Tool "${toolName}" not found.\n\nAvailable tools:\n${
                toolsList || "No tools available yet."
              }`,
            },
          ],
        };
      }

      // Execute the tool by calling the HTTP server
      const executeResponse = await fetch(
        `${HTTP_SERVER_URL}/api/execute-tool`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            toolName,
            parameters: parameters ? JSON.parse(parameters) : {},
          }),
        }
      );

      if (!executeResponse.ok) {
        const errorText = await executeResponse.text();
        return {
          content: [
            {
              type: "text",
              text: `Error executing tool "${toolName}": ${errorText}`,
            },
          ],
        };
      }

      const result = await executeResponse.json();

      return {
        content: [
          {
            type: "text",
            text:
              result.content ||
              result.message ||
              JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error.message}`,
          },
        ],
      };
    }
  }
);

// Helper tool to list all available dynamic tools
server.tool(
  "list-available-tools",
  "List all dynamically created tools and their descriptions",
  {},
  async () => {
    try {
      const response = await fetch(`${HTTP_SERVER_URL}/api/tools`);

      if (!response.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Could not connect to HTTP server at ${HTTP_SERVER_URL}`,
            },
          ],
        };
      }

      const tools = await response.json();

      if (tools.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No dynamic tools have been created yet. Monetize some content first!",
            },
          ],
        };
      }

      const toolsList = tools
        .map((tool) => `• **${tool.name}**: ${tool.description}`)
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Available Dynamic Tools (${tools.length}):\n\n${toolsList}\n\nUse execute-dynamic-tool to run any of these tools.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error.message}`,
          },
        ],
      };
    }
  }
);

// Tool to get detailed information about a specific tool
server.tool(
  "get-tool-info",
  "Get detailed information about a specific dynamic tool",
  {
    toolName: z
      .string()
      .describe("The name of the tool to get information about"),
  },
  async ({ toolName }) => {
    try {
      const response = await fetch(
        `${HTTP_SERVER_URL}/api/tool-info/${toolName}`
      );

      if (!response.ok) {
        if (response.status === 404) {
          return {
            content: [
              {
                type: "text",
                text: `Tool "${toolName}" not found. Use list-available-tools to see all available tools.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `Error: Could not get tool information (${response.status})`,
            },
          ],
        };
      }

      const toolInfo = await response.json();

      return {
        content: [
          {
            type: "text",
            text: `**Tool:** ${toolInfo.name}\n**Description:** ${
              toolInfo.description
            }\n\n**Content Preview:**\n${toolInfo.content.substring(0, 500)}${
              toolInfo.content.length > 500 ? "..." : ""
            }\n\n**Full Content Length:** ${
              toolInfo.content.length
            } characters`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error.message}`,
          },
        ],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Proxy Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in MCP main():", error);
  process.exit(1);
});
