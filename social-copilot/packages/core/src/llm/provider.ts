import type { LLMInput, LLMOutput, LLMProvider, ReplyCandidate, ReplyStyle } from '../types';

/**
 * DeepSeek API Provider
 */
export class DeepSeekProvider implements LLMProvider {
  readonly name = 'deepseek';
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(config: { apiKey: string; baseUrl?: string; model?: string }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.deepseek.com';
    this.model = config.model || 'deepseek-chat';
  }

  async generateReply(input: LLMInput): Promise<LLMOutput> {
    const task = input.task ?? 'reply';
    const startTime = Date.now();
    const prompt = task === 'profile_extraction'
      ? this.buildProfilePrompt(input)
      : this.buildReplyPrompt(input);

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: this.getSystemPrompt(input) },
          { role: 'user', content: prompt },
        ],
        temperature: 0.8,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const candidates = this.parseResponse(content, input.styles, task);

    return {
      candidates,
      model: this.model,
      latency: Date.now() - startTime,
      raw: data,
    };
  }

  private getSystemPrompt(input: LLMInput): string {
    if ((input.task ?? 'reply') === 'profile_extraction') {
      const lang = input.language === 'zh' ? '中文' : 'English';
      return `你是一个社交画像分析助手，根据对话更新联系人画像。

输出要求：
1. 使用${lang}返回结果
2. 仅返回 JSON 对象，包含: interests[], communicationStyle{}, basicInfo{}, relationshipType, notes
3. communicationStyle 可包含 prefersShortMessages、usesEmoji、formalityLevel(casual/neutral/formal)
4. basicInfo 可包含 ageRange、occupation、location
5. relationshipType 用于标记关系（如 friend/colleague/family）
6. notes 用于补充无法结构化的信息`;
    }

    const lang = input.language === 'zh' ? '中文' : 'English';
    let systemPrompt = `你是一个高情商社交助理，帮助用户生成聊天回复建议。

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

    // 添加思路方向提示
    if (input.thoughtHint) {
      systemPrompt += `\n\n【回复方向】${input.thoughtHint}`;
    }

    return systemPrompt;
  }

  private buildReplyPrompt(input: LLMInput): string {
    const { context, profile, memorySummary } = input;
    let prompt = '';

    // 联系人信息
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

    // 记忆摘要
    if (memorySummary) {
      prompt += `【历史记忆】${memorySummary}\n\n`;
    }

    // 对话上下文
    prompt += '【最近对话】\n';
    for (const msg of context.recentMessages) {
      const role = msg.direction === 'incoming' ? profile?.displayName || '对方' : '我';
      prompt += `${role}: ${msg.text}\n`;
    }

    // 当前消息
    prompt += `\n【待回复消息】\n${context.currentMessage.senderName}: ${context.currentMessage.text}`;
    prompt += `\n\n请生成 ${input.styles.length} 个不同风格的回复建议，风格分别为：${input.styles.join('、')}`;

    // 添加思路方向提示
    if (input.thoughtHint) {
      prompt += `\n\n【回复方向要求】${input.thoughtHint}`;
    }

    return prompt;
  }

  private buildProfilePrompt(input: LLMInput): string {
    const { context, profile, memorySummary } = input;
    const contactName = profile?.displayName || context.contactKey.peerId;
    const relationship = profile?.relationshipType || '未知';
    const interests = profile?.interests?.join('、') || '未知';
    const styleSummary = profile?.communicationStyle
      ? JSON.stringify(profile.communicationStyle)
      : '未知';

    const recent = context.recentMessages.map(msg => {
      const role = msg.direction === 'incoming' ? msg.senderName : '我';
      return `${role}: ${msg.text}`;
    }).join('\n');
    const current = context.currentMessage
      ? `${context.currentMessage.direction === 'incoming' ? context.currentMessage.senderName : '我'}: ${context.currentMessage.text}`
      : '';

    return `请根据对话更新与「${contactName}」相关的画像信息，并仅返回 JSON 对象。
现有画像：关系(${relationship})，兴趣(${interests})，沟通偏好(${styleSummary})
${memorySummary ? `补充说明：${memorySummary}\n` : ''}对话片段：
${recent}${current ? `\n${current}` : ''}

只输出 JSON，如：
{"interests":[],"communicationStyle":{},"basicInfo":{},"relationshipType":"","notes":""}`;
  }

  private parseResponse(content: string, styles: ReplyStyle[], task?: LLMInput['task']): ReplyCandidate[] {
    if ((task ?? 'reply') === 'profile_extraction') {
      const objectMatch = content.match(/\{[\s\S]*\}/);
      const text = objectMatch ? objectMatch[0] : content.trim();
      return [{
        style: styles[0] || 'rational',
        text,
        confidence: objectMatch ? 0.8 : 0.5,
      }];
    }

    try {
      // 尝试提取 JSON
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
      // JSON 解析失败，降级处理
    }

    // 降级：将整个内容作为单个回复
    return [{
      style: styles[0] || 'casual',
      text: content.trim(),
      confidence: 0.5,
    }];
  }
}
