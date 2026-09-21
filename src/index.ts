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

type ReferenceRole =
  | "character"
  | "scene"
  | "composition"
  | "style"
  | "frame";

type ReferenceImage = {
  data: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  role?: ReferenceRole;
  name?: string;
  description?: string;

  /**
   * Optional metadata supplied by the client.
   *
   * Cloudflare FLUX.2 Klein 4B requires reference images
   * to be smaller than 512x512.
   *
   * The client should resize before base64 encoding.
   */
  width?: number;
  height?: number;
};

const MODEL = "@cf/black-forest-labs/flux-2-klein-4b";

const MAX_REFERENCE_IMAGES = 4;

/**
 * Protect the Worker from accidentally receiving extremely large
 * base64 payloads.
 *
 * A correctly resized sub-512x512 reference should normally be
 * comfortably below this.
 */
const MAX_REFERENCE_BASE64_LENGTH = 4_000_000;

/**
 * Output sizes.
 *
 * Cloudflare FLUX.2 Klein 4B supports width/height up to 1920.
 */
function getDimensions(format: Format) {
  switch (format) {
    case "portrait":
      return {
        width: 1080,
        height: 1920,
        ratioLabel: "9:16",
      };

    case "square":
      return {
        width: 1080,
        height: 1080,
        ratioLabel: "1:1",
      };

    case "landscape":
    default:
      return {
        width: 1920,
        height: 1080,
        ratioLabel: "16:9",
      };
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

/**
 * Build instructions describing how each reference image should
 * influence the generated result.
 *
 * FLUX can refer to multipart reference images by index:
 * Image 0, Image 1, etc.
 */
function buildReferenceInstructions(
  references: ReferenceImage[] = []
): string {
  if (references.length === 0) {
    return "";
  }

  const lines = references.map((reference, index) => {
    const role = reference.role ?? "reference";
    const name = reference.name
      ? ` named "${reference.name}"`
      : "";

    const description = reference.description
      ? ` ${reference.description}`
      : "";

    return `- Image ${index}: ${role}${name}.${description}`;
  });

  return `
REFERENCE IMAGES:

${lines.join("\n")}

REFERENCE IMAGE RULES:

- Use each image according to its assigned role.
- Do not merge unrelated characters together.
- Do not swap the identities of characters.

For CHARACTER reference images:
- Use the corresponding image as the primary visual reference for that character.
- Preserve the important distinguishing visual features.
- Preserve species, body proportions, colors, facial characteristics, hair/feathers/fur, outfit, accessories and other recognizable design details where applicable.
- Keep the character visually consistent with the provided reference while placing them naturally into the requested new scene.
- Do not replace the referenced character with a generic interpretation.

For FRAME, SCENE or COMPOSITION reference images:
- Use the image for scene layout, environment, pose, staging, camera angle or action guidance as appropriate.
- Do not treat incidental subjects in a scene reference as required characters unless specifically requested.

For STYLE reference images:
- Use the image for visual treatment, rendering approach, lighting, texture or design language.
- Do not unnecessarily copy unrelated subjects from the style image.

When the prompt refers to Image 0, Image 1, Image 2 or Image 3, it refers to the corresponding supplied reference image.
`;
}

function buildPrompt(input: {
  format: Format;
  idea: string;
  title: string;
  stylePreset: StylePreset;
  extraDetails?: string;
  referenceImages?: ReferenceImage[];
}) {
  const {
    format,
    idea,
    title,
    stylePreset,
    extraDetails,
    referenceImages = [],
  } = input;

  const { ratioLabel } = getDimensions(format);

  const styleText = buildStylePrompt(stylePreset);

  const referenceText =
    buildReferenceInstructions(referenceImages);

  return `
Create an image in ${ratioLabel} aspect ratio.

MAIN IDEA:
${idea}

TITLE TO INCLUDE IN THE DESIGN:
"${title}"

STYLE PRESET:
${stylePreset}

${styleText}

${referenceText}

GENERAL REQUIREMENTS:

- Follow the requested main idea closely.
- The title should appear prominently and clearly in the image when the requested visual type requires title text.
- Keep title text large, bold and readable.
- Do not invent unrelated text.
- Avoid watermarks.
- Keep the composition visually strong and suitable for its intended poster, thumbnail or reference-image purpose.
- Use professional composition, polished lighting and high visual clarity.
- Make the final image look finished and presentation-ready.

ADDITIONAL DETAILS:
${extraDetails || "None."}
`;
}

/**
 * Convert either:
 *
 *     /9j/4AAQ...
 *
 * or:
 *
 *     data:image/jpeg;base64,/9j/4AAQ...
 *
 * into a Blob suitable for multipart FormData.
 */
function base64ToBlob(
  inputData: string,
  requestedMimeType: string
): Blob {
  let base64Data = inputData.trim();
  let mimeType = requestedMimeType;

  if (base64Data.startsWith("data:")) {
    const match = base64Data.match(
      /^data:([^;,]+);base64,(.+)$/s
    );

    if (!match) {
      throw new Error(
        "Invalid reference image data URL."
      );
    }

    const dataUrlMimeType = match[1];
    base64Data = match[2];

    /**
     * Prefer the actual MIME type declared by the data URL.
     */
    if (dataUrlMimeType) {
      mimeType = dataUrlMimeType;
    }
  }

  base64Data = base64Data.replace(/\s/g, "");

  if (base64Data.length === 0) {
    throw new Error(
      "Reference image contains no base64 data."
    );
  }

  if (
    base64Data.length >
    MAX_REFERENCE_BASE64_LENGTH
  ) {
    throw new Error(
      "Reference image base64 payload is too large. Resize/compress the reference image before sending it to the MCP server."
    );
  }

  let binary: string;

  try {
    binary = atob(base64Data);
  } catch {
    throw new Error(
      "Reference image contains invalid base64 data."
    );
  }

  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], {
    type: mimeType,
  });
}

/**
 * Extra runtime validation.
 *
 * The Zod MCP schema already prevents supplied width/height values
 * from exceeding 511, but keeping this validation here makes the
 * model requirement explicit.
 */
function validateReferences(
  references: ReferenceImage[]
) {
  if (
    references.length >
    MAX_REFERENCE_IMAGES
  ) {
    throw new Error(
      `A maximum of ${MAX_REFERENCE_IMAGES} reference images is supported.`
    );
  }

  references.forEach((reference, index) => {
    if (
      reference.width !== undefined &&
      reference.width >= 512
    ) {
      throw new Error(
        `Reference image ${index} width is ${reference.width}px. FLUX.2 Klein 4B reference images must be smaller than 512x512.`
      );
    }

    if (
      reference.height !== undefined &&
      reference.height >= 512
    ) {
      throw new Error(
        `Reference image ${index} height is ${reference.height}px. FLUX.2 Klein 4B reference images must be smaller than 512x512.`
      );
    }
  });
}

/**
 * Add reference images using Cloudflare's required multipart
 * parameter names:
 *
 * input_image_0
 * input_image_1
 * input_image_2
 * input_image_3
 */
function appendReferenceImages(
  form: FormData,
  references: ReferenceImage[]
) {
  validateReferences(references);

  references.forEach((reference, index) => {
    const blob = base64ToBlob(
      reference.data,
      reference.mimeType
    );

    form.append(
      `input_image_${index}`,
      blob
    );
  });
}

/**
 * Run FLUX through the Workers AI binding.
 *
 * FLUX.2 Klein requires multipart input even for
 * text-only generation.
 */
async function runFlux(
  env: Env,
  form: FormData
) {
  const encoded = new Response(form);

  const body = encoded.body;

  const contentType =
    encoded.headers.get("content-type");

  if (!body || !contentType) {
    throw new Error(
      "Unable to create multipart request for Cloudflare Workers AI."
    );
  }

  return env.AI.run(MODEL, {
    multipart: {
      body,
      contentType,
    },
  });
}

function createServer(env: Env) {
  const server = new McpServer({
    name: "Cloudflare Image Generator",
    version: "2.1.0",
  });

  /**
   * -------------------------------------------------------
   * LEGACY SIMPLE IMAGE GENERATOR
   * -------------------------------------------------------
   *
   * Retained for backward compatibility.
   *
   * This remains text-to-image only.
   */
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
          .describe(
            "Natural language prompt for the image."
          ),
      }),
    },

    async ({ prompt }) => {
      try {
        const form = new FormData();

        form.append("prompt", prompt);
        form.append("width", "1920");
        form.append("height", "1080");

        const result: any =
          await runFlux(env, form);

        if (!result?.image) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "Cloudflare Workers AI did not return an image.",
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
                "Generated 1920x1080 image using Cloudflare Workers AI FLUX.2 Klein 4B.",
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `Image generation failed: ${message}`,
            },
          ],
        };
      }
    }
  );

  /**
   * -------------------------------------------------------
   * ENHANCED VISUAL GENERATOR
   * -------------------------------------------------------
   *
   * Supports:
   *
   * - portrait 9:16
   * - landscape 16:9
   * - square 1:1
   * - title
   * - idea
   * - style presets
   * - extra details
   * - optional multi-reference image conditioning
   */
  server.registerTool(
    "generate_visual",
    {
      description:
        "Generate a designed visual using Cloudflare Workers AI FLUX.2 Klein 4B. Supports portrait (9:16), landscape (16:9), square (1:1), title, visual idea, style presets, and up to 4 optional reference images for character, scene, composition, frame, or style conditioning.",

      inputSchema: z.object({
        format: z
          .enum([
            "portrait",
            "landscape",
            "square",
          ])
          .describe(
            "Output format: portrait = 9:16, landscape = 16:9, square = 1:1."
          ),

        idea: z
          .string()
          .min(1)
          .max(4000)
          .describe(
            "The visual concept or scene to create."
          ),

        title: z
          .string()
          .min(1)
          .max(300)
          .describe(
            "Main title/text intended for the visual."
          ),

        stylePreset: z
          .enum([
            "coming_soon_poster",
            "cluck_pearl_thumbnail",
            "moment_vs_shot",
            "character_bible_reference",
          ])
          .describe(
            "Visual style/layout preset."
          ),

        extraDetails: z
          .string()
          .max(4000)
          .optional()
          .describe(
            "Optional extra instructions including character descriptions, scene details, layout requirements, camera notes, outfit details, or other generation instructions."
          ),

        reference_images: z
          .array(
            z.object({
              data: z
                .string()
                .min(1)
                .max(
                  MAX_REFERENCE_BASE64_LENGTH
                )
                .describe(
                  "Base64 encoded reference image. A complete data URL such as data:image/png;base64,... is also accepted."
                ),

              mimeType: z
                .enum([
                  "image/jpeg",
                  "image/png",
                  "image/webp",
                ])
                .describe(
                  "MIME type of the reference image."
                ),

              role: z
                .enum([
                  "character",
                  "scene",
                  "composition",
                  "style",
                  "frame",
                ])
                .optional()
                .describe(
                  "How the reference should influence generation."
                ),

              name: z
                .string()
                .max(150)
                .optional()
                .describe(
                  "Optional name identifying the referenced character, frame, scene, or visual."
                ),

              description: z
                .string()
                .max(1000)
                .optional()
                .describe(
                  "Additional instructions explaining how this particular reference should be used."
                ),

              width: z
                .number()
                .int()
                .positive()
                .max(511)
                .optional()
                .describe(
                  "Optional actual width of the pre-resized reference image. Must be below 512 pixels."
                ),

              height: z
                .number()
                .int()
                .positive()
                .max(511)
                .optional()
                .describe(
                  "Optional actual height of the pre-resized reference image. Must be below 512 pixels."
                ),
            })
          )
          .max(MAX_REFERENCE_IMAGES)
          .optional()
          .describe(
            "Optional reference images used for multi-reference image conditioning. Maximum 4. Each image must be pre-resized to smaller than 512x512 before sending."
          ),
      }),
    },

    async ({
      format,
      idea,
      title,
      stylePreset,
      extraDetails,
      reference_images,
    }) => {
      try {
        const {
          width,
          height,
          ratioLabel,
        } = getDimensions(format);

        const references:
          ReferenceImage[] =
          reference_images ?? [];

        validateReferences(references);

        const prompt = buildPrompt({
          format,
          idea,
          title,
          stylePreset,
          extraDetails,
          referenceImages: references,
        });

        const form = new FormData();

        form.append("prompt", prompt);
        form.append(
          "width",
          String(width)
        );
        form.append(
          "height",
          String(height)
        );

        /**
         * Attach binary references only when supplied.
         *
         * Existing text-only callers continue to work
         * exactly as before.
         */
        if (references.length > 0) {
          appendReferenceImages(
            form,
            references
          );
        }

        const result: any =
          await runFlux(env, form);

        if (!result?.image) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "Cloudflare Workers AI did not return an image.",
              },
            ],
          };
        }

        const referenceSummary =
          references.length > 0
            ? `${references.length} reference image${references.length === 1 ? "" : "s"} used for conditioning.`
            : "No reference images were supplied; generation used text prompting only.";

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
                `Provider: Cloudflare Workers AI. ` +
                `Model: FLUX.2 Klein 4B. ` +
                `Format: ${format} (${ratioLabel}). ` +
                `Size: ${width}x${height}. ` +
                `Style preset: ${stylePreset}. ` +
                `Title: "${title}". ` +
                referenceSummary,
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `Visual generation failed: ${message}`,
            },
          ],
        };
      }
    }
  );

  return server;
}

export default {
  fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ) {
    return createMcpHandler(
      () => createServer(env)
    )(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
