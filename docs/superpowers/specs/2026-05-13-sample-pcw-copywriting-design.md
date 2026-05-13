# Sample Data v2 · 商品文案改写 · Design Spec

- **Date**: 2026-05-13
- **Status**: Draft（pending implementation）
- **Author**: Claude（with kuen54）
- **Predecessor**: [`docs/superpowers/findings/2026-05-13-sample-data-redesign-lessons.md`](../findings/2026-05-13-sample-data-redesign-lessons.md)（v1 失败教训）

## 0. 一句话产品定位

业务评测员（运营 / PM / 业务端码农）进 evalyst 探索"这工具值不值得接入"，看完 sample 后**动手建自己第一个 evaluation**。Sample 主信息：**evalyst 能跨 prompt 对比，帮你选最优方案**。

## 1. lessons §6.4 硬约束 checklist（这次必须满足）

- [x] 纯文本任务（不碰多模态——生图、vision judge 后续 PR 单独做）
- [x] input ≤ 200 字
- [x] output schema ≤ 5 字段（实际 4 字段）
- [x] 评分 ≤ 5 维（pass_fail × 1 + likert × 3 + score_0_100 × 1）
- [x] 跨场景内聚（同一类业务任务的多个变体）
- [x] 30-60 条够 demo（实际 60 条）
- [x] 可手工编（不依赖开源 benchmark）
- [x] 避开 kimi（用 claude-opus-4-6 主跑 + gpt-4o-mini judge）
- [x] **每 schema display_dimensions[].header_fields 必填**（lesson 批评 #3 闭环）
- [x] ship 数据全 strip status=error（demo 是橱窗）
- [x] 验收"30 秒外行能看懂"硬条目

## 2. Sample suite 总体结构

| Resource | Id | 数量 |
|---|---|---|
| Dataset | `product_copywriting_v1` | 60 条 |
| Schemas (同 compare_group="product_copywriting_v1") | `pcw_xhs_v1` / `pcw_douyin_v1` / `pcw_friends_v1` | 3 |
| Rubric | `pcw_quality` | 5 维 |
| Judge prompt | `pcw_quality.judge.md` | 1 |
| Sample experiments | `pcw_xhs_baseline` / `pcw_douyin_baseline` / `pcw_friends_baseline` | 3 |
| 总 records | 60 × 3 schema × 1 model = 180 | |
| Annotation | 全 180 条 4o-mini 跑过 5 维 | |

**Display 形态**: 隐式推断 → `builtin_single_list`（display_dimensions 1 个 dim：category）。**不**用 user display（lessons §6.4 #1 硬约束：display_dimensions[].header_fields 把 input 字段带进来即可，不需要自定义 display）。

## 3. Dataset `product_copywriting_v1`

**字段**:

| key | type | label | 说明 | 示例 |
|---|---|---|---|---|
| `pid` | string (id_field) | 商品 ID | 主键 | `prod_001` |
| `name` | string | 商品名 | ≤ 30 字 | `轻氧空气感蓬蓬粉` |
| `category` | string | 品类 | 6 类（见下） | `美妆` |
| `price` | string | 价格 | 含币种 | `¥158` |
| `core_features` | array (3-4 string) | 核心卖点 | 每条 ≤ 20 字 | `["微米级粉体", "保湿不卡纹", "持妆8小时"]` |
| `target_user` | string | 目标用户画像 | ≤ 50 字 | `25-35 岁通勤女性，油性肌` |

**6 品类，每类 10 条 = 60 条**:
1. 美妆
2. 数码
3. 食品饮料
4. 家居
5. 服饰
6. 母婴

**编写要求**:
- 商品参数**手工编**，要"像真实在卖"（不能"商品 A / 商品 B"占位）
- 每类内价位档分布（低 30% / 中 50% / 高 20%）
- target_user 必须具体（年龄 / 场景 / 痛点），避免空话

**Source**: `src/lib/seeds/datasets/product_copywriting_v1.{meta.json,jsonl}`，跟 PR #96 seed 子目录扫描机制兼容。

## 4. Schemas (3 个，同 `compare_group: "product_copywriting_v1"`)

### 4.1 共用结构

```json
{
  "id": "<pcw_*_v1>",
  "label": "商品文案改写 · <平台风>",
  "version": 1,
  "compare_group": "product_copywriting_v1",
  "inputs": [
    {
      "alias": "p",
      "dataset_id": "product_copywriting_v1",
      "filters": [
        {
          "kind": "multiselect",
          "key": "categories",
          "field": "category",
          "label": "品类",
          "options": [
            { "value": "美妆", "label": "美妆" },
            { "value": "数码", "label": "数码" },
            { "value": "食品饮料", "label": "食品饮料" },
            { "value": "家居", "label": "家居" },
            { "value": "服饰", "label": "服饰" },
            { "value": "母婴", "label": "母婴" }
          ],
          "defaultValue": ["美妆", "数码", "食品饮料", "家居", "服饰", "母婴"]
        },
        { "kind": "number", "key": "limit", "role": "limit", "label": "Limit (blank = all)" }
      ]
    }
  ],
  "variables": [
    { "name": "name", "source": "p.name" },
    { "name": "category", "source": "p.category" },
    { "name": "price", "source": "p.price" },
    { "name": "features", "source": "p.core_features", "transform": [{ "op": "join", "sep": "、" }] },
    { "name": "target_user", "source": "p.target_user" }
  ],
  "default_prompt": "<see 4.2-4.4>",
  "message_builder": {
    "user_template": "请为这个商品写一条文案。"
  },
  "output_schema": {
    "type": "object",
    "required": ["title", "body"],
    "properties": {
      "title": { "type": "string", "max_length": 30 },
      "body": { "type": "string", "max_length": 600 },
      "hashtags": { "type": "array", "items": { "type": "string" } },
      "cta": { "type": "string", "max_length": 50 }
    }
  },
  "display_dimensions": [
    {
      "field": "input_preview.p.category",
      "label": "品类",
      "header_fields": [
        { "field": "input_preview.p.name", "label": "商品" },
        { "field": "input_preview.p.target_user", "label": "目标用户" },
        { "field": "input_preview.p.price", "label": "价" }
      ]
    }
  ]
}
```

### 4.2 `pcw_xhs_v1` · 小红书风

**default_prompt**:

```
你是小红书种草达人。给定商品信息，输出一条小红书爆款风格的文案：

要求：
- title：≤ 30 字，吸引眼球，可用 emoji
- body：第一人称，"我用了..."的真实体验感，≤ 300 字
- hashtags：3-5 个相关标签
- cta：1 句话引导（"姐妹们冲鸭"风）

输出 JSON：{"title", "body", "hashtags": [...], "cta"}

商品名：{{name}}
品类：{{category}}
价格：{{price}}
核心卖点：{{features}}
目标用户：{{target_user}}
```

### 4.3 `pcw_douyin_v1` · 抖音脚本风

**default_prompt**:

```
你是抖音带货脚本撰稿人。给定商品信息，输出 30 秒视频脚本：

要求：
- title：≤ 30 字，钩子式开头（疑问/反差/数字）
- body：3-5 段视频脚本，每段对应 5-10 秒口播；段落用空行分隔；包含"提出问题→展示卖点→对比效果→引导购买"结构；≤ 400 字
- hashtags：1-3 个抖音热门标签（可空）
- cta：明确的购买引导

输出 JSON：{"title", "body", "hashtags": [...], "cta"}

商品名：{{name}}
品类：{{category}}
价格：{{price}}
核心卖点：{{features}}
目标用户：{{target_user}}
```

### 4.4 `pcw_friends_v1` · 朋友圈风

**default_prompt**:

```
你是个普通用户，刚买了一个东西想发朋友圈推荐给朋友。

要求：
- title：≤ 20 字，口语化，不要"震惊体"
- body：≤ 80 字（短）；"昨天买了 / 这次回购 / 朋友推荐"风；不要用"种草"这类小红书黑话
- hashtags：留空（朋友圈不用 hashtag）
- cta：留空（朋友圈不强推）

输出 JSON：{"title", "body", "hashtags": [], "cta": ""}

商品名：{{name}}
品类：{{category}}
价格：{{price}}
核心卖点：{{features}}
目标用户：{{target_user}}
```

**3 个 prompt 的对比维度**:
- 风格强度：抖音 ≫ 小红书 ≫ 朋友圈
- 长度：抖音 ≈ 小红书 ≫ 朋友圈
- 商业感：抖音 ≫ 小红书 ≫ 朋友圈
- hashtag 用量：小红书 ≫ 抖音 ≫ 朋友圈（空）

→ 评测员一眼能看出"3 个 prompt 在同商品上风格差异极大"，对比叙事强烈。

## 5. Rubric `pcw_quality`（5 维 × 3 type）

| key | type | required | 说明 |
|---|---|---|---|
| `key_features_covered` | pass_fail | true | 核心卖点（core_features）至少覆盖 2 条以上（有名 / 隐含都算）|
| `style_match` | likert_1_5 | false | 风格对路（小红书像小红书 / 抖音像抖音 / 朋友圈像朋友圈，不串味）|
| `attractiveness` | likert_1_5 | false | 吸引力 / 转化潜力（站在目标用户视角）|
| `length_appropriate` | likert_1_5 | false | 长度合适（不啰嗦也不简陋；按平台合理范围）|
| `overall_score` | score_0_100 | false | 综合分 |

## 6. Judge prompt (`src/lib/seeds/judges/pcw_quality.judge.md`)

```
你是商品文案评审员。给定一份文案 + 商品参数 + 平台风格，按以下 4 维评分（key_features_covered 由 LLM 自己判断，输出 true/false）。

商品参数：
- 名：{{name}}
- 品类：{{category}}
- 价：{{price}}
- 核心卖点：{{features}}
- 目标用户：{{target_user}}

平台风格：{{platform_style}}（小红书 / 抖音 / 朋友圈）

模型生成的文案：
- title：{{output_title}}
- body：{{output_body}}
- hashtags：{{output_hashtags}}
- cta：{{output_cta}}

输出严格 JSON：
{
  "scores": {
    "key_features_covered": true | false,
    "style_match": 1-5,
    "attractiveness": 1-5,
    "length_appropriate": 1-5,
    "overall_score": 0-100
  },
  "rationale": "中文，30-80 字，重点说哪一维扣了分"
}
```

`{{platform_style}}` 由 runner 根据 schema_id 注入：xhs → 小红书 / douyin → 抖音 / friends → 朋友圈。

## 7. Sample experiments

3 个，全部用 `claude-opus-4-6` 主跑 + `gpt-4o-mini` 当 judge。

| Experiment id | Schema | Records |
|---|---|---|
| `pcw_xhs_baseline` | `pcw_xhs_v1` | 60 |
| `pcw_douyin_baseline` | `pcw_douyin_v1` | 60 |
| `pcw_friends_baseline` | `pcw_friends_v1` | 60 |

每个 ship `meta json`（在 `src/lib/seeds/experiments/`）+ `results.jsonl` + `annotations.jsonl`（**两者同目录**：`src/lib/seeds/results/<exp_id>/{results,annotations}.jsonl`，对齐 evalyst runtime `data/results/<exp_id>/{results,annotations}.jsonl` 嵌套约定，`src/lib/annotation-store.ts:14`）。

**关键 demo 路径（验收）**:
1. user 进 `/experiments` → 看到 3 个 baseline 实验
2. 点任一进详情页 → 看到 60 条结果，row header 显示**商品名 / 目标用户 / 价格**（30 秒外行能看懂）
3. toolbar 看到「**对比 (vs 2)**」按钮（PR #97 入口）
4. 点击 → `/compare` 自动预选 3 个 → 一行同商品三个文案版本横排
5. 评测员看出："xhs prompt 在美妆得分高 / friends prompt 在低价位品类得分高 / douyin prompt 在数码品类得分高"——具体结论实测时见

## 8. 跑数据（user 端操作）

不在本 PR scope 内 commit results，而是 ship 一个**轻量 runner 脚本**：

```
scripts/run-pcw-samples.ts  (zero-dep, ~100 行)
```

逻辑：
1. 读 `data/llm-config.json` 拿 opus + 4o-mini 配置
2. 读 `src/lib/seeds/datasets/product_copywriting_v1.jsonl`（60 条）
3. 对每个 schema × 60 records 跑 callLlm（opus），写 `data/results/<exp_id>/results.jsonl`
4. 跑完拉 4o-mini judge 跑 5 维度，写 `data/annotations/<exp_id>/annotations.jsonl`
5. **strip status!=success 的 record**（lessons §6.4 #4）
6. 拷贝到 `src/lib/seeds/results/<exp_id>/results.jsonl` + `src/lib/seeds/annotations/<exp_id>/annotations.jsonl` ship 进 git

**user 跑命令**: `npm run run:pcw-samples`，约 30 分钟，~¥13。跑完后同 branch commit results/annotations，PR ready for review。

## 9. 验收 (lessons §6.4 闭环)

- [ ] 60 条 dataset 编完（6 品类 × 10 条平衡），每条 input ≤ 200 字
- [ ] 3 schemas 共享 compare_group="product_copywriting_v1"
- [ ] **每 schema display_dimensions[].header_fields 把 input 字段带入展示**
- [ ] rubric 5 维 × 3 type
- [ ] judge prompt 文档完整，含 `{{platform_style}}` 注入
- [ ] runner 脚本 zero-dep（仅 Node 18+ 内置 fetch）
- [ ] 浏览器实测："30 秒外行能看懂这是干嘛 + 哪个 prompt 赢"
- [ ] PR #97 对比入口能从详情页一键跳进 /compare 看 3 列横排
- [ ] ship 进 git 的 results.jsonl 全 status=success（用户 strip 后）
- [ ] tsc / vitest / lint / build / knip 全绿

## 10. 不在 scope（backlog）

- 生图场景 sample（PR #2 of this stream）
- 多 display 形态（table / grouped_grid / jsx / triple_grid / bubble_overlay）（PR #3 of this stream）
- LLM-as-judge UI 改动
- compare_group 字段在 schema 编辑器更亲和（独立潜在 PR）
- "对比"入口的 inline mini view（lessons §6.5 推荐方案 B）

## 11. 与 v1 失败 spec 的差异

| 维度 | v1 (failed) | v2 (this) |
|---|---|---|
| 数据源 | 4 套 ML benchmark（GSM8K/BELLE/Parti/RefCOCO） | 1 套手编业务场景（商品文案）|
| 场景数 | 4（三象限）| 1（聚焦）|
| Schema 数 | 7 | 3 |
| Display 形态覆盖 | 7 全 | 1（builtin_single_list）|
| 多模态 | 是（生图 + VQA）| 否（纯文本）|
| Records | 616 | 180 |
| 模型 | 7 个，含 kimi-k2.6 | 1 个（opus），judge 1 个（4o-mini）|
| 预算 | ~¥100 | ~¥13 |
| Wall time | ~6 小时 | ~30 分钟 |
| 目标用户 | 隐含 ML researcher | 明确 业务评测员 |
| 主信息 | 三象限 + 7 display 矩阵思维 | 跨 prompt 对比（明确）|
| 失败时回滚 | 全废 | 此次 sample 自包含可独立回滚 |
