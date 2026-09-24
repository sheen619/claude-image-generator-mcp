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

type GenerationMode =
  | "new_from_reference"
  | "edit_existing";

type ReferenceRole =
  | "source"
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
  width?: number;
  height?: number;
};

const MODEL =
  "@cf/black-forest-labs/flux-2-klein-4b";

const MAX_REFERENCE_IMAGES = 4;

const MAX_REFERENCE_BASE64_LENGTH =
  4_000_000;

/**
 * ============================================================
 * OUTPUT SIZE
 * ============================================================
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

/**
 * ============================================================
 * STYLE PRESETS
 * ============================================================
 */

function buildStylePrompt(
  stylePreset: StylePreset
) {
  switch (stylePreset) {
    case "coming_soon_poster":
      return `
Create a polished promotional poster.

Use:
- strong visual hierarchy
- cinematic composition
- clear focal subject
- rich lighting
- strong subject separation
- promotional poster quality
- clean areas for typography when visible text is requested

The result should look like finished professional campaign artwork.
`;

    case "cluck_pearl_thumbnail":
      return `
Create a highly clickable animated comedy thumbnail.

Use:
- expressive faces
- clear visual storytelling
- exaggerated but believable character emotion
- dynamic action
- strong foreground/background separation
- polished 3D animation rendering
- detailed feathers/fur/materials where applicable
- cinematic lighting
- vibrant but controlled color
- shallow depth of field where appropriate
- clean composition readable at thumbnail size

Do not overcrowd the scene.
`;

    case "moment_vs_shot":
      return `
Create a premium wildlife / photography thumbnail.

The composition should clearly communicate:
THE CAPTURE MOMENT versus THE FINAL SHOT.

Where appropriate:
- show the photographer/setup separately from the final animal image
- use strong visual separation
- use realistic photography
- use cinematic natural lighting
- keep the wildlife subject highly detailed
- keep the composition easy to understand instantly
`;

    case "character_bible_reference":
      return `
Create a completely new production-quality character reference image.

Use:
- clean neutral studio background
- clear full-body presentation
- professional studio lighting
- readable silhouette
- highly detailed character design
- accurate material, feather, fur and fabric rendering
- clean centered composition
- production-reference quality

Do not add visible text unless explicitly requested.

The final image should look like a NEW production render,
not a modified copy of a supplied reference photograph.
`;

    default:
      return "";
  }
}

/**
 * ============================================================
 * GENERATION MODE
 * ============================================================
 */

function buildGenerationModeInstructions(
  mode: GenerationMode,
  hasReferences: boolean
) {
  if (mode === "edit_existing") {
    return `
GENERATION MODE: EDIT EXISTING IMAGE

This is an image-editing request.

Treat Image 0 as the SOURCE IMAGE / CANVAS.

Preserve parts of Image 0 that the request does not ask to change.

Make the requested modification while maintaining reasonable consistency
with the original image.

Additional reference images, if supplied, may provide character, style,
scene or composition guidance.

Do not make unnecessary changes to unrelated elements.

IMPORTANT:
Only use this editing behavior because generationMode is explicitly
"edit_existing".
`;
  }

  if (!hasReferences) {
    return `
GENERATION MODE: NEW IMAGE

Generate a completely new image from scratch.

Follow the requested scene, composition, style, lighting and subject details.
`;
  }

  return `
GENERATION MODE: NEW IMAGE FROM REFERENCES

THIS IS NOT AN IMAGE-EDITING REQUEST.

Generate a COMPLETELY NEW IMAGE FROM SCRATCH.

The supplied images are references only.

DO NOT:
- paint directly over a reference image
- place clothing as an overlay on the original reference
- reuse the reference image as the final canvas
- copy the reference's exact pose unless the prompt requests it
- copy the reference's exact camera framing unless requested
- copy the reference's exact background unless requested
- copy the reference's exact composition unless requested

Reconstruct the requested subjects as NEW renders in the requested:
- pose
- action
- clothing
- environment
- composition
- camera framing
- lighting

REFERENCE PRIORITY RULE:

The reference defines WHO or WHAT the subject is.

The user prompt defines WHAT THE NEW IMAGE SHOULD BECOME.

If the requested change conflicts with a reference image,
THE REQUESTED CHANGE WINS for that change.

Examples:

If the reference character is not wearing a suit but the prompt asks for
a black formal suit:
CREATE A NEW BLACK FORMAL SUIT.

Do NOT preserve the old outfit.

If the prompt asks for a new pose:
CREATE THE NEW POSE.

Do NOT preserve the source pose.

If the prompt asks for a city:
CREATE THE CITY.

Do NOT preserve the source studio background.

If the prompt asks for a new expression:
CREATE THE NEW EXPRESSION.

The final result must look like a newly generated production image,
not an edited copy of the reference.
`;
}

/**
 * ============================================================
 * REFERENCE IMAGE INSTRUCTIONS
 * ============================================================
 */

function buildReferenceInstructions(
  references: ReferenceImage[],
  generationMode: GenerationMode
): string {
  if (references.length === 0) {
    return "";
  }

  const mapping = references.map(
    (reference, index) => {
      const role =
        reference.role ?? "character";

      const name = reference.name
        ? ` — ${reference.name}`
        : "";

      const description =
        reference.description
          ? `\n  Purpose: ${reference.description}`
          : "";

      return `Image ${index}: ${role}${name}${description}`;
    }
  );

  let rules = `
REFERENCE IMAGE MAP:

${mapping.join("\n")}

GENERAL REFERENCE RULES:

- Keep each image associated with its declared role.
- Never merge unrelated characters.
- Never swap character identities.
- Never create duplicate versions of a character unless requested.
`;

  if (generationMode === "new_from_reference") {
    rules += `

CHARACTER REFERENCE RULES:

For a reference whose role is "character":

Use it as an IDENTITY / CHARACTER-DESIGN reference.

Preserve permanent identity features where applicable:
- species
- recognizable face design
- eye appearance
- beak, muzzle or nose structure
- comb, hair, fur or feather design
- permanent feather/fur/hair colors
- body proportions
- silhouette
- distinctive markings
- permanent accessories only when they are part of the character identity

DO NOT automatically preserve:
- pose
- facial expression
- clothing
- temporary accessories
- background
- camera angle
- camera framing
- source composition

If the requested prompt changes one of those elements,
follow the requested prompt.

OUTFIT RULE:

If a NEW outfit is requested, construct the new outfit naturally around
the newly rendered character.

Do not simply paint the new clothing over the reference image.

The new clothing should have:
- believable construction
- proper fabric folds
- natural fit
- correct interaction with the character's anatomy
- appropriate occlusion of feathers/fur/body where clothing covers them

FRAME / SCENE / COMPOSITION REFERENCES:

Use these only for:
- staging
- environment
- action
- camera placement
- pose guidance
- scene layout

Do not use incidental characters visible in a frame as identity references
unless explicitly instructed.

STYLE REFERENCES:

Use these for:
- rendering treatment
- color treatment
- lighting
- texture
- visual language

Do not copy unrelated subjects from a style reference.
`;
  } else {
    rules += `

EDIT MODE:

Image 0 should normally be treated as the source image.

Other references may guide:
- character appearance
- styling
- composition
- replacement elements
- scene details

Preserve unrelated source-image elements unless the prompt asks to change
them.
`;
  }

  return rules;
}

/**
 * ============================================================
 * TITLE BEHAVIOR
 * ============================================================
 */

function buildTitleInstructions(
  title: string,
  renderTitle: boolean
) {
  if (!renderTitle) {
    return `
TITLE METADATA:
"${title}"

IMPORTANT:
The title above is metadata/context only.

DO NOT render this title in the image.
DO NOT add captions.
DO NOT add labels.
DO NOT add random lettering.
DO NOT add a watermark.
`;
  }

  return `
VISIBLE TITLE:
"${title}"

Render the title clearly when appropriate for the requested poster/thumbnail.

Requirements:
- accurate spelling
- strong visual hierarchy
- readable at small size
- do not cover important faces
- do not invent unrelated extra text
`;
}

/**
 * ============================================================
 * FINAL PROMPT BUILDER
 * ============================================================
 */

function buildPrompt(input: {
  format: Format;
  idea: string;
  title: string;
  stylePreset: StylePreset;
  extraDetails?: string;
  referenceImages?: ReferenceImage[];
  generationMode: GenerationMode;
  renderTitle: boolean;
}) {
  const {
    format,
    idea,
    title,
    stylePreset,
    extraDetails,
    referenceImages = [],
    generationMode,
    renderTitle,
  } = input;

  const { ratioLabel } =
    getDimensions(format);

  const styleInstructions =
    buildStylePrompt(stylePreset);

  const modeInstructions =
    buildGenerationModeInstructions(
      generationMode,
      referenceImages.length > 0
    );

  const referenceInstructions =
    buildReferenceInstructions(
      referenceImages,
      generationMode
    );

  const titleInstructions =
    buildTitleInstructions(
      title,
      renderTitle
    );

  return `
IMAGE CREATION TASK

OUTPUT ASPECT RATIO:
${ratioLabel}

MAIN CREATIVE REQUEST:
${idea}

STYLE PRESET:
${stylePreset}

${modeInstructions}

${referenceInstructions}

${styleInstructions}

${titleInstructions}

ADDITIONAL PRODUCTION INSTRUCTIONS:

${extraDetails || "No additional instructions."}

FINAL QUALITY REQUIREMENTS:

- Follow the requested creative concept closely.
- Keep important subjects visually distinct.
- Use coherent anatomy.
- Use believable materials and textures.
- Use polished professional lighting.
- Maintain clear depth and visual hierarchy.
- Avoid unwanted duplicate characters.
- Avoid malformed limbs or merged bodies.
- Avoid random objects.
- Avoid random text.
- Avoid watermarks.
- Produce a finished, high-quality image.

MOST IMPORTANT:

If generationMode is "new_from_reference",
the result must be a NEWLY GENERATED IMAGE.

It must NOT look like clothing, objects or effects were simply painted over
the original reference image.
`;
}

/**
 * ============================================================
 * BASE64 → BLOB
 * ============================================================
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

    const dataUrlMimeType =
      match[1];

    base64Data =
      match[2];

    if (dataUrlMimeType) {
      mimeType = dataUrlMimeType;
    }
  }

  base64Data =
    base64Data.replace(/\s/g, "");

  if (!base64Data) {
    throw new Error(
      "Reference image contains no base64 data."
    );
  }

  if (
    base64Data.length >
    MAX_REFERENCE_BASE64_LENGTH
  ) {
    throw new Error(
      "Reference image is too large. Resize/compress it before sending it to the MCP server."
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

  const bytes =
    new Uint8Array(binary.length);

  for (
    let i = 0;
    i < binary.length;
    i++
  ) {
    bytes[i] =
      binary.charCodeAt(i);
  }

  return new Blob(
    [bytes],
    {
      type: mimeType,
    }
  );
}

/**
 * ============================================================
 * REFERENCE VALIDATION
 * ============================================================
 */

function validateReferences(
  references: ReferenceImage[],
  generationMode: GenerationMode
) {
  if (
    references.length >
    MAX_REFERENCE_IMAGES
  ) {
    throw new Error(
      `A maximum of ${MAX_REFERENCE_IMAGES} reference images is supported.`
    );
  }

  if (
    generationMode ===
      "edit_existing" &&
    references.length === 0
  ) {
    throw new Error(
      'generationMode "edit_existing" requires at least one reference image.'
    );
  }

  references.forEach(
    (reference, index) => {
      if (
        reference.width !==
          undefined &&
        reference.width >= 512
      ) {
        throw new Error(
          `Reference image ${index} width is ${reference.width}px. Reference images must be smaller than 512x512.`
        );
      }

      if (
        reference.height !==
          undefined &&
        reference.height >= 512
      ) {
        throw new Error(
          `Reference image ${index} height is ${reference.height}px. Reference images must be smaller than 512x512.`
        );
      }
    }
  );
}

/**
 * ============================================================
 * ADD REFERENCES TO FLUX MULTIPART
 * ============================================================
 */

function appendReferenceImages(
  form: FormData,
  references: ReferenceImage[],
  generationMode: GenerationMode
) {
  validateReferences(
    references,
    generationMode
  );

  references.forEach(
    (reference, index) => {
      const blob =
        base64ToBlob(
          reference.data,
          reference.mimeType
        );

      form.append(
        `input_image_${index}`,
        blob
      );
    }
  );
}

/**
 * ============================================================
 * WORKERS AI CALL
 * ============================================================
 */

async function runFlux(
  env: Env,
  form: FormData
) {
  const encoded =
    new Response(form);

  const body =
    encoded.body;

  const contentType =
    encoded.headers.get(
      "content-type"
    );

  if (!body || !contentType) {
    throw new Error(
      "Unable to create multipart request for Cloudflare Workers AI."
    );
  }

  return env.AI.run(
    MODEL,
    {
      multipart: {
        body,
        contentType,
      },
    }
  );
}

/**
 * ============================================================
 * MCP SERVER
 * ============================================================
 */

function createServer(env: Env) {
  const server =
    new McpServer({
      name:
        "Cloudflare Image Generator",
      version: "3.0.0",
    });

  /**
   * ----------------------------------------------------------
   * SIMPLE LEGACY TOOL
   * ----------------------------------------------------------
   */

  server.registerTool(
    "generate_image",
    {
      description:
        "Generate a basic 1920x1080 text-to-image visual using Cloudflare Workers AI FLUX.2 Klein 4B.",

      inputSchema: z.object({
        prompt: z
          .string()
          .min(1)
          .max(4000)
          .describe(
            "Detailed image-generation prompt."
          ),
      }),
    },

    async ({ prompt }) => {
      try {
        const form =
          new FormData();

        form.append(
          "prompt",
          prompt
        );

        form.append(
          "width",
          "1920"
        );

        form.append(
          "height",
          "1080"
        );

        const result: any =
          await runFlux(
            env,
            form
          );

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
              mimeType:
                "image/jpeg",
            },
            {
              type: "text",
              text:
                "Generated a 1920x1080 image using Cloudflare Workers AI FLUX.2 Klein 4B.",
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
   * ----------------------------------------------------------
   * ENHANCED VISUAL TOOL
   * ----------------------------------------------------------
   */

  server.registerTool(
    "generate_visual",
    {
      description:
        "Generate a new visual or explicitly edit an existing visual using Cloudflare FLUX.2 Klein 4B. Supports aspect-ratio presets, style presets, visible or metadata-only titles, and up to 4 reference images.",

      inputSchema: z.object({
        format: z
          .enum([
            "portrait",
            "landscape",
            "square",
          ])
          .describe(
            "portrait = 9:16, landscape = 16:9, square = 1:1."
          ),

        idea: z
          .string()
          .min(1)
          .max(6000)
          .describe(
            "Detailed production-quality description of the NEW image or requested edit."
          ),

        title: z
          .string()
          .min(1)
          .max(300)
          .describe(
            "Title or identifying metadata for this visual."
          ),

        renderTitle: z
          .boolean()
          .optional()
          .describe(
            "Whether the title should actually appear visually in the generated image. Set false for character references or requests saying no text."
          ),

        generationMode: z
          .enum([
            "new_from_reference",
            "edit_existing",
          ])
          .optional()
          .describe(
            'Use "new_from_reference" to create a brand-new image using references only for identity/style/composition. Use "edit_existing" only when the user explicitly wants the original image itself modified.'
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
          .max(6000)
          .optional()
          .describe(
            "Additional production instructions such as composition, lighting, camera, new outfit, constraints, environment, character consistency, and negative requirements."
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
                  "Base64 reference image or complete data:image/...;base64,... URL."
                ),

              mimeType: z
                .enum([
                  "image/jpeg",
                  "image/png",
                  "image/webp",
                ])
                .describe(
                  "Reference image MIME type."
                ),

              role: z
                .enum([
                  "source",
                  "character",
                  "scene",
                  "composition",
                  "style",
                  "frame",
                ])
                .optional()
                .describe(
                  "How this reference image should be used."
                ),

              name: z
                .string()
                .max(150)
                .optional()
                .describe(
                  "Character/reference name."
                ),

              description: z
                .string()
                .max(1200)
                .optional()
                .describe(
                  "Specific instructions describing what should and should not be taken from this reference."
                ),

              width: z
                .number()
                .int()
                .positive()
                .max(511)
                .optional()
                .describe(
                  "Actual width of pre-resized reference. Must be less than 512."
                ),

              height: z
                .number()
                .int()
                .positive()
                .max(511)
                .optional()
                .describe(
                  "Actual height of pre-resized reference. Must be less than 512."
                ),
            })
          )
          .max(MAX_REFERENCE_IMAGES)
          .optional()
          .describe(
            "Optional reference images. Maximum 4. Each must be pre-resized to smaller than 512x512."
          ),
      }),
    },

    async ({
      format,
      idea,
      title,
      renderTitle,
      generationMode,
      stylePreset,
      extraDetails,
      reference_images,
    }) => {
      try {
        const {
          width,
          height,
          ratioLabel,
        } =
          getDimensions(format);

        const references:
          ReferenceImage[] =
          reference_images ?? [];

        /**
         * Default to NEW generation.
         *
         * This is intentionally safer than defaulting to editing,
         * because supplying a reference should not automatically
         * turn it into the source canvas.
         */
        const resolvedMode:
          GenerationMode =
          generationMode ??
          "new_from_reference";

        /**
         * Character reference images normally should contain
         * no visible title.
         *
         * Other presets default to visible title.
         */
        const resolvedRenderTitle =
          renderTitle ??
          (stylePreset !==
            "character_bible_reference");

        validateReferences(
          references,
          resolvedMode
        );

        const prompt =
          buildPrompt({
            format,
            idea,
            title,
            stylePreset,
            extraDetails,
            referenceImages:
              references,
            generationMode:
              resolvedMode,
            renderTitle:
              resolvedRenderTitle,
          });

        const form =
          new FormData();

        form.append(
          "prompt",
          prompt
        );

        form.append(
          "width",
          String(width)
        );

        form.append(
          "height",
          String(height)
        );

        if (
          references.length > 0
        ) {
          appendReferenceImages(
            form,
            references,
            resolvedMode
          );
        }

        const result: any =
          await runFlux(
            env,
            form
          );

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
            ? `${references.length} reference image${references.length === 1 ? "" : "s"} used.`
            : "No reference images used.";

        return {
          content: [
            {
              type: "image",
              data: result.image,
              mimeType:
                "image/jpeg",
            },

            {
              type: "text",
              text:
                `Generated successfully. ` +
                `Provider: Cloudflare Workers AI. ` +
                `Model: FLUX.2 Klein 4B. ` +
                `Mode: ${resolvedMode}. ` +
                `Format: ${format} (${ratioLabel}). ` +
                `Size: ${width}x${height}. ` +
                `Style: ${stylePreset}. ` +
                `Visible title: ${resolvedRenderTitle ? "yes" : "no"}. ` +
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

/**
 * ============================================================
 * WORKER ENTRY POINT
 * ============================================================
 */

export default {
  fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ) {
    return createMcpHandler(
      () => createServer(env)
    )(
      request,
      env,
      ctx
    );
  },
} satisfies ExportedHandler<Env>;
