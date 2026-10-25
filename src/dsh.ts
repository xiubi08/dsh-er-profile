/** Minimal structural Cordis/DSH surfaces used by this plugin. */

export interface ImageAttachmentRef {
  attachmentId: string
  mediaType: string
  bytes: number
  width: number
  height: number
  name?: string
}

export interface AttachmentService {
  saveImage(input: { data: Uint8Array; mediaType: 'image/png'; name?: string }): Promise<ImageAttachmentRef>
}

export interface ToolRunContext {
  readonly signal: AbortSignal
  readonly agent?: {
    readonly id?: string
    readonly session?: { readonly id?: string }
  }
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render: (args: unknown, value: unknown) => { type: 'text'; text: string }[]
    presentationMeta?: (args: unknown, value: unknown) => unknown
  }
  execute: (args: unknown, exec: ToolRunContext) => Promise<unknown>
}

export interface Logger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export interface Context {
  readonly tools: { register(definition: ToolDefinition): () => void }
  readonly logger: Logger
  readonly attachments?: AttachmentService
  get?<T>(name: string): T | undefined
  effect?(fn: () => (() => void) | void, label?: string): void
}
