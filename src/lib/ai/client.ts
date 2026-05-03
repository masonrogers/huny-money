import Anthropic from '@anthropic-ai/sdk';
import { config } from '@/lib/config';

let _anthropic: Anthropic | null = null;

function getAnthropic(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

export const MODEL = 'claude-sonnet-4-6';
export const MAX_TOKENS = 8192;

export async function callClaude(params: {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
}): Promise<string> {
  const { systemPrompt, userMessage, maxTokens = MAX_TOKENS } = params;

  const response = await getAnthropic().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: userMessage,
      },
    ],
  });

  // Log token usage for cost tracking
  const { input_tokens, output_tokens } = response.usage;
  const usage = response.usage as unknown as Record<string, number>;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;

  console.log(
    `[AI] Tokens — input: ${input_tokens}, output: ${output_tokens}, ` +
      `cache_read: ${cacheRead}, cache_creation: ${cacheCreation}`
  );

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('[AI] No text content in Claude response');
  }

  return textBlock.text;
}
