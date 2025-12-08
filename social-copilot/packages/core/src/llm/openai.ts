import type { LLMInput, LLMOutput, LLMProvider, ReplyCandidate, ReplyStyle } from '../types';

/**
 * OpenAI API Provider
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(config: { apiKey: string; baseUrl?: string; model?: string }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.openai.com';
    this.model = config.model || 'gpt-4o-mini';
  }

  async generateReply(input: LLMInput): Promise<LLMOutput> {
    const task = input.task ?? 'reply';
    const startTime = Date.now();
    const prompt = task === 'profile_extraction'
      ? this.buildProfilePrompt(input)
      : this.buildReplyPrompt(input);
    const systemPrompt = task === 'profile_extraction'
      ? this.getProfileSystemPrompt(input)
      : this.getReplySystemPrompt(input);

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.8,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const candidates = task === 'profile_extraction'
      ? this.parseProfileResponse(content)
      : this.parseReplyResponse(content, input.styles);

    return {
      candidates,
      model: this.model,
      latency: Date.now() - startTime,
      raw: data,
    };
  }

  private getReplySystemPrompt(input: LLMInput): string {
    const lang = input.language === 'zh' ? '中文' : 'English';
    return `你是一个高情商社交助理，帮助用户生成聊天回复建议。

规则：
1. 根据对话上下文和联系人特点，生成自然、得体的回复
2. 每次生成 ${input.styles.length} 个不同风格的候选回复
3. 回复要像真人说话，不要暴露 AI 身份
4. 使用${lang}回复
5. 输出格式为 JSON 数组：[{"style": "风格", "text": "回复内容"}, ...]

风格说明：
- humorous: 幽默风趣
- caring: 关心体贴
- rational: 理性客观
- casual: 随意轻松
- formal: 正式礼貌`;
  }

  private getProfileSystemPrompt(input: LLMInput): string {
    const lang = input.language === 'zh' ? '中文' : 'English';
    return `你是一个社交画像分析助手，根据对话更新联系人的画像信息。

输出要求：
1. 使用${lang}返回结果
2. 仅返回 JSON 对象，包含: interests[], communicationStyle{}, basicInfo{}, relationshipType, notes
3. communicationStyle 包含 prefersShortMessages, usesEmoji, formalityLevel (casual/neutral/formal)
4. basicInfo 包含 ageRange, occupation, location
5. relationshipType 用于标记关系（friend/colleague/family/other）
6. notes 用于补充无法结构化的信息`;
  }

  private buildReplyPrompt(input: LLMInput): string {
    const { context, profile, memorySummary } = input;
    let prompt = '';

    if (profile) {
      prompt += `【联系人】${profile.displayName}`;
      if (profile.relationshipType) {
        prompt += `（${profile.relationshipType}）`;
      }
      if (profile.interests.length > 0) {
        prompt += `\n兴趣：${profile.interests.join('、')}`;
      }
      prompt += '\n\n';
    }

    if (memorySummary) {
      prompt += `【历史记忆】${memorySummary}\n\n`;
    }

    prompt += '【最近对话】\n';
    for (const msg of context.recentMessages) {
      const role = msg.direction === 'incoming' ? (profile?.displayName || '对方') : '我';
      prompt += `${role}: ${msg.text}\n`;
    }

    prompt += `\n【待回复消息】\n${context.currentMessage.senderName}: ${context.currentMessage.text}`;
    prompt += `\n\n请生成 ${input.styles.length} 个不同风格的回复建议，风格分别为：${input.styles.join('、')}`;

    return prompt;
  }

  private buildProfilePrompt(input: LLMInput): string {
    const { context, profile, memorySummary } = input;
    const targetName = profile?.displayName || context.contactKey.peerId;
    const styleSummary = profile?.communicationStyle
      ? JSON.stringify(profile.communicationStyle)
      : '未知';
    let prompt = `请根据聊天记录更新「${targetName}」的画像，使用 JSON 输出。\n`;

    if (profile) {
      prompt += `现有画像：兴趣(${profile.interests.join('、') || '未知'})，关系(${profile.relationshipType || '未知'})，沟通偏好(${styleSummary})\n`;
    }

    if (memorySummary) {
      prompt += `历史摘要：${memorySummary}\n`;
    }

    prompt += '最近对话：\n';
    for (const msg of context.recentMessages) {
      const role = msg.direction === 'incoming' ? (profile?.displayName || '对方') : '我';
      prompt += `${role}: ${msg.text}\n`;
    }

    prompt += `当前消息：${context.currentMessage.senderName}: ${context.currentMessage.text}\n`;
    prompt += '请返回 JSON，例如：{"interests":[],"communicationStyle":{},"basicInfo":{},"relationshipType":"","notes":""}';
    return prompt;
  }

  private parseReplyResponse(content: string, styles: ReplyStyle[]): ReplyCandidate[] {
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.map((item: { style: ReplyStyle; text: string }) => ({
          style: item.style,
          text: item.text,
          confidence: 0.8,
        }));
      }
    } catch {
      // JSON 解析失败
    }

    return [
      {
        style: styles[0] || 'casual',
        text: content.trim(),
        confidence: 0.5,
      },
    ];
  }

  private parseProfileResponse(content: string): ReplyCandidate[] {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const text = jsonMatch ? jsonMatch[0] : content.trim();

    return [
      {
        style: 'rational',
        text,
        confidence: jsonMatch ? 0.8 : 0.5,
      },
    ];
  }
}
