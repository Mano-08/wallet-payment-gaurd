import express from "express";
import lighthouse from "@lighthouse-web3/sdk";
import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { withPaymentInterceptor } from "x402-axios";
import { baseSepolia, bsc, filecoinCalibration } from "viem/chains";
import { createWalletClient, http, publicActions } from "viem";
dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const lighthouseApiKey = process.env.LIGHTHOUSE_API_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;

const tools = new Map();


// MCP Server
const server = new McpServer({
  name: "wordpress-mcp",
  version: "1.0.1",
  capabilities: {
    resources: {},
    tools: {},
  },
});

async function getSummariesFromAI(blogContent) {
  const prompt = `Analyze the following text and generate two things. Provide your response as a single, valid JSON object with two keys: "toolName" (a single, descriptive, kebab-case word for a command-line tool) and "summary" (a concise one-sentence summary of the text).

Text: """
${blogContent}
"""`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      console.error("Gemini API Error Response:", await response.text());
      throw new Error(`Gemini API request failed with status ${response.status}`);
    }

    const data = await response.json();
    const aiContent = data.candidates[0].content.parts[0].text;
    const jsonMatch = aiContent.match(/{[\s\S]*}/);
    if (!jsonMatch) throw new Error("AI did not return valid JSON.");

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error("Error getting summaries from AI:", error);
    return {
      toolName: `tool-${Date.now()}`,
      summary: "Summary could not be generated.",
    };
  }
}

function addDynamicTool(name, description, content) {
  tools.set(name, { description, content });

  server.tool(
    name,
    description,
    {
      name: z.string().describe(`regarding ${name}, ${description}`),
    },
    async ({ name }) => ({
      content: [
        {
          type: "text",
          text: name + " " + content,
        },
      ],
    })
  );


  console.log(`Tool ${name} added ${description} successfully and the content is ${content}`);
}

app.post("/api/send", async (req, res) => {
  console.log("POST request received:", req.body);
  const { content: blogContent, title, wallet_address } = req.body;

  if (!blogContent) {
    return res.status(400).json({ message: "Content is required." });
  }

  try {
    console.log("Uploading content to Lighthouse...");
    const lighthouseResponse = await lighthouse.uploadText(blogContent, lighthouseApiKey, wallet_address);
    console.log("Lighthouse response:", lighthouseResponse);

    console.log("Generating summary with AI...");
    const hash = lighthouseResponse.data.Hash;
    const fetchResponse = await fetch(`https://gateway.lighthouse.storage/ipfs/${hash}`);
    const text = await fetchResponse.text();
    console.log("Blog Content:", text);
    const { toolName, summary } = await getSummariesFromAI(text);

    const toolDescription = summary || `Tutorial: ${title || toolName}`;
    addDynamicTool(toolName, toolDescription, text);

    res.status(200).json({
      message: "Content monetized and tool created successfully!",
      toolName: toolName,
      lighthouseHash: lighthouseResponse.data.Hash,
    });
  } catch (error) {
    console.error("Error in /api/send:", error);
    res.status(500).json({ message: "An internal server error occurred." });
  }
});

app.get("/api/tools", (req, res) => {
  const toolList = Array.from(tools.entries()).map(([name, toolData]) => ({
    name: name,
    description: toolData.description,
  }));

  res.status(200).json(toolList);
});

app.listen(3000, async () => {
  console.log("Server is running on port 3000");
});



async function main() {
 const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
