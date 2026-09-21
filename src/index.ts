import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

type Env = {
  AI: Ai;
};

function createServer(env: Env) {
  const server = new McpServer({
    name: "Cloudflare Image Generator",
    version: "1.0.0",
  });

  server.registerTool(
    "generate_image",
    {
      description:
        "Generate a 1920x1080 image from a natural-language prompt using Cloudflare Workers AI.",
      inputSchema: z.object({
        prompt: z
          .string()
          .min(1)
          .max(4000)
          .describe("Description of the image to generate."),
      }),
    },
    async ({ prompt }) => {
      const form = new FormData();

      form.append("prompt", prompt);
      form.append("width", "1920");
      form.append("height", "1080");

      const formResponse = new Response(form);
      const body = formResponse.body;
      const contentType = formResponse.headers.get("content-type");

      if (!body || !contentType) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Unable to create multipart image request.",
            },
          ],
        };
      }

      const result = await env.AI.run(
        "@cf/black-forest-labs/flux-2-klein-4b",
        {
          multipart: {
            body,
            contentType,
          },
        },
      );

      const image = (result as { image?: string }).image;

      if (!image) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Cloudflare Workers AI did not return an image.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "image",
            data: image,
            mimeType: "image/jpeg",
          },
          {
            type: "text",
            text: "Generated a 1920x1080 image with Cloudflare Workers AI.",
          },
        ],
      };
    },
  );

  return server;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return createMcpHandler(() => createServer(env))(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
