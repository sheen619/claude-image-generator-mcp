import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

type Env = {
  AI: any;
};

type Format = "portrait" | "landscape" | "square";
type StylePreset =
  | "coming_soon_poster"
  | "cluck_pearl_thumbnail"
  | "moment_vs_shot"
  | "character_bible_reference";

function getDimensions(format: Format) {
  switch (format) {
    case "portrait":
      return { width: 1080, height: 1920, ratioLabel: "9:16" };
    case "square":
      return { width: 1080, height: 1080, ratioLabel: "1:1" };
    case "landscape":
    default:
      return { width: 1920, height: 1080, ratioLabel: "16:9" };
  }
}

function buildStylePrompt(stylePreset: StylePreset) {
  switch (stylePreset) {
    case "coming_soon_poster":
      return `
Create a polished promotional poster image.
Use a bold, eye-catching poster composition with a strong focal subject.
Make it cinematic, highly appealing, clean, modern, and dramatic.
Large title-friendly composition, visual hierarchy, high contrast, rich color, polished poster style.
Suitable for a "coming soon" announcement poster.
`;
    case "cluck_pearl_thumbnail":
      return `
Create a highly clickable YouTube thumbnail style image.
Use a bright, colorful, high-energy 3D animated look.
Strong facial expressions, exaggerated emotion, dynamic action, clean subject separation, shallow depth of field.
Make it look like a polished comedy-family animation thumbnail.
Keep the composition simple, bold, and easy to understand at small size.
Leave strong space for readable title text.
`;
    case "moment_vs_shot":
      return `
Create a dramatic wildlife / photography thumbnail composition.
The image should visually communicate "the moment vs the final shot".
Prefer a split composition or a strong upper/lower narrative:
- one area shows the photographer or the scene setup,
- another area shows the final striking wildlife subject/photo result.
Use a realistic, cinematic, documentary-thumbnail feel.
Make it bold, clear, emotional, and very clickable.
Allow strong title placement.
`;
    case "character_bible_reference":
      return `
Create a clean character reference / character bible image.
Use a neutral studio-style background, centered composition, clean lighting, and clear visibility of the full character.
Focus on character design clarity, readable silhouette, outfit detail, and presentation quality.
Avoid busy backgrounds.
Make it feel like a polished reference image for production use.
`;
    default:
      return "";
  }
}

function buildPrompt(input: {
  format: Format;
  idea: string;
  title: string;
  stylePreset: StylePreset;
  extraDetails?: string;
}) {
  const { format, idea, title, stylePreset, extraDetails } = input;
  const { ratioLabel } = getDimensions(format);
  const styleText = buildStylePrompt(stylePreset);

  return `
Create an image in ${ratioLabel} aspect ratio.

Main idea:
${idea}

Title to include in the design:
"${title}"

Style preset:
${stylePreset}

${styleText}

General requirements:
- The title should appear prominently and clearly in the image.
- Keep text large, bold, and readable.
- Make the composition visually strong and suitable for social media or thumbnail/poster use.
- Use professional composition, polished lighting, and high visual clarity.
- Avoid watermarks and avoid random extra text.
- Make the final image look finished and presentation-ready.

Additional details:
${extraDetails || "None."}
`;
}

function createServer(env: Env) {
  const server = new McpServer({
    name: "Cloudflare Image Generator",
    version: "2.0.0",
  });

  // Legacy simple tool retained for compatibility
  server.registerTool(
    "generate_image",
    {
      description:
        "Generate a basic 1920x1080 image from a natural-language prompt using Cloudflare Workers AI.",
      inputSchema: z.object({
        prompt: z
          .string()
          .min(1)
          .max(4000)
          .describe("Natural language prompt for the image."),
      }),
    },
    async ({ prompt }) => {
      const form = new FormData();
      form.append("prompt", prompt);
      form.append("width", "1920");
      form.append("height", "1080");

      const encoded = new Response(form);
      const body = encoded.body;
      const contentType = encoded.headers.get("content-type");

      if (!body || !contentType) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Unable to create multipart request for image generation.",
            },
          ],
        };
      }

      const result: any = await env.AI.run(
        "@cf/black-forest-labs/flux-2-klein-4b",
        {
          multipart: {
            body,
            contentType,
          },
        }
      );

      if (!result?.image) {
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
            data: result.image,
            mimeType: "image/jpeg",
          },
          {
            type: "text",
            text: "Generated 1920x1080 image.",
          },
        ],
      };
    }
  );

  // New enhanced tool
  server.registerTool(
    "generate_visual",
    {
      description:
        "Generate a designed visual using a chosen format, idea, title, and style preset. Supports portrait (9:16), landscape (16:9), and square (1:1).",
      inputSchema: z.object({
        format: z
          .enum(["portrait", "landscape", "square"])
          .describe("portrait = 9:16, landscape = 16:9, square = 1:1"),
        idea: z
          .string()
          .min(1)
          .max(4000)
          .describe("The visual concept or scene to create."),
        title: z
          .string()
          .min(1)
          .max(300)
          .describe("Main text/title to appear in the design."),
        stylePreset: z
          .enum([
            "coming_soon_poster",
            "cluck_pearl_thumbnail",
            "moment_vs_shot",
            "character_bible_reference",
          ])
          .describe("The visual style/layout preset."),
        extraDetails: z
          .string()
          .max(2000)
          .optional()
          .describe("Optional extra instructions, character notes, layout notes, etc."),
      }),
    },
    async ({ format, idea, title, stylePreset, extraDetails }) => {
      const { width, height, ratioLabel } = getDimensions(format);

      const prompt = buildPrompt({
        format,
        idea,
        title,
        stylePreset,
        extraDetails,
      });

      const form = new FormData();
      form.append("prompt", prompt);
      form.append("width", String(width));
      form.append("height", String(height));

      const encoded = new Response(form);
      const body = encoded.body;
      const contentType = encoded.headers.get("content-type");

      if (!body || !contentType) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Unable to create multipart request for visual generation.",
            },
          ],
        };
      }

      const result: any = await env.AI.run(
        "@cf/black-forest-labs/flux-2-klein-4b",
        {
          multipart: {
            body,
            contentType,
          },
        }
      );

      if (!result?.image) {
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
            data: result.image,
            mimeType: "image/jpeg",
          },
          {
            type: "text",
            text:
              `Generated visual successfully. ` +
              `Format: ${format} (${ratioLabel}), ` +
              `Size: ${width}x${height}, ` +
              `Style preset: ${stylePreset}, ` +
              `Title: "${title}"`,
          },
        ],
      };
    }
  );

  return server;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return createMcpHandler(() => createServer(env))(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
