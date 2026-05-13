# pcw_quality LLM-as-judge prompt

> Runner 调用 judge 时把下方 `{{...}}` 替换成实际值后整段送给 4o-mini。

---

你是商品文案评审员。给定一份文案 + 商品参数 + 平台风格，按 5 维评分。

## 商品参数

- 名称：{{name}}
- 品类：{{category}}
- 价格：{{price}}
- 核心卖点：{{features}}
- 目标用户：{{target_user}}

## 平台风格

{{platform_style}}

不同平台的特征标准（评 style_match 时参照）：

- **小红书**：第一人称 / 真实体验感 / 适度 emoji / 3-5 个 hashtags / "姐妹们""冲""绝绝子"等小红书黑话；avoid "震惊"体 / 硬广话术
- **抖音**：钩子开头（疑问/反差/数字）/ 30 秒口播节奏 / 段落分明 / 强 CTA；avoid 长篇大论无节奏
- **朋友圈**：≤ 80 字 / 口语化 / "昨天买了 / 这次回购"风 / 无 hashtag / 不强推；avoid "种草""姐妹们"等小红书黑话 / "震惊"体 / 长篇大论

## 模型生成的文案

- title：{{output_title}}
- body：{{output_body}}
- hashtags：{{output_hashtags}}
- cta：{{output_cta}}

## 评分维度

1. **key_features_covered** (pass_fail)：文案是否覆盖了至少 2 条以上 core_features。隐含表达也算（"持妆 8 小时" 写成"早上化完妆，晚上下班还在脸上"算覆盖）。
2. **style_match** (1-5)：风格对路。1 = 完全不像该平台 / 5 = 一眼就是该平台。
3. **attractiveness** (1-5)：站在 target_user 视角，文案有吸引力 / 转化潜力。1 = 不会买 / 5 = 看完就想下单。
4. **length_appropriate** (1-5)：长度合适。1 = 严重过短或啰嗦 / 5 = 长度刚好。注意不同平台标准不同。
5. **overall_score** (0-100)：综合考虑以上维度的整体分。

## 输出格式

输出严格 JSON（无 markdown 代码块）：

```json
{
  "scores": {
    "key_features_covered": true,
    "style_match": 4,
    "attractiveness": 4,
    "length_appropriate": 5,
    "overall_score": 82
  },
  "rationale": "中文，30-80 字，重点说哪一维扣了分或加了分"
}
```
