---
name: evalyst-dataset
description: "为 evalyst 评测平台创建新「数据集」。Use when: 用户在 evalyst 项目里说「加个数据集」「new dataset for eval」「建一份 records」等，需要产出 data/datasets/{id}.meta.json + data/datasets/{id}.jsonl 两个文件。NOT for: 编辑已有数据集（直接对话改即可）、evalyst 项目以外的数据集、LLM 模型配置。"
---

# evalyst · 新建数据集

本 skill 帮你（Claude）为 evalyst 评测平台创建一份合规的「数据集」，直接把 `data/datasets/{id}.meta.json` + `data/datasets/{id}.jsonl` 两个文件写到磁盘。平台下次访问 `/settings/datasets` 时会自动扫到它（`listDatasets()` 每次调用都幂等扫目录），无需重启 dev server。

## Step 1 · 前置确认

1. 用 Bash `pwd` 确认当前工作目录在 evalyst 项目根（有 `package.json` 且依赖含 `next`）。否则停止，告诉用户需要 `cd` 进项目目录再跑。
2. 读以下两个文件作为权威参考：
   - `src/lib/meta-prompts/dataset.ts` —— 数据集 JSON 结构的完整示例与字段语义（**严格按它**）
   - `src/lib/schema/types.ts` 里的 `DatasetDef` / `FieldDef` 接口定义（字段 type 的合法枚举）
3. 用 Glob `data/datasets/*.meta.json` 列出现有数据集，避免 id 冲突并给用户参考范式。

## Step 2 · 与用户对齐需求

如果用户的初始请求已经给足下面 4 项信息，**跳过询问**，直接动手；否则用 AskUserQuestion 或自然对话问清：

1. **业务背景**：每条 record 代表什么？这个数据集要配合哪个评测任务？
2. **字段列表**：字段名 + type（`string` / `number` / `boolean` / `url` / `array` / `object`）+ 可选的 `label`
3. **id_field**：哪个字段当主键（必须每条都非空且唯一）
4. **records 来源**：用户会粘贴 / 本地有 CSV 或 JSONL / 让你根据业务生成

如果 records 来自 CSV，用户需要告诉你文件路径，你 Read 后自己做字段类型推断（看到 `"1"` / `"true"` 之类字符串能自动 coerce 成 number / boolean）。

## Step 3 · 产出两个文件

### `data/datasets/{id}.meta.json`

```json
{
  "id": "lowercase_snake_case_id",
  "name": "人类可读的展示名",
  "description": "一句话说明（可选）",
  "source": "upload",
  "id_field": "字段名",
  "fields": [
    { "key": "字段名", "type": "string|number|boolean|url|array|object", "label": "可选展示名" }
  ]
}
```

### `data/datasets/{id}.jsonl`

每行一条 JSON 对象，字段与 `meta.json` 的 `fields` 对齐。

**用 Write 工具**直接写这两个文件即可（非 runtime 代码路径，不强制走 `writeAtomic`）。

## Step 4 · 自我校验

写完后自己过一遍（不要让用户当 QA）：

- [ ] `id` 匹配 `/^[a-z][a-z0-9_]*$/`（小写字母开头、下划线分隔）
- [ ] 目标文件**不存在于**当前磁盘上，不会覆盖别人
- [ ] `id_field` 出现在 `fields[].key` 里
- [ ] records 数量 ≥ 1
- [ ] 每条 record 都有 `id_field` 且值非 null
- [ ] `id_field` 值在所有 records 里唯一（列一下 `new Set(records.map(r => r[id_field]))` 的 size 等于 records.length）
- [ ] fields 里每个字段都在至少一条 record 里出现（避免声明未用字段）
- [ ] jsonl 每行都能 JSON.parse（写完后可以 Bash `python3 -c "open('data/datasets/{id}.jsonl').read().splitlines(); [json.loads(l) for l in ...]"` 快速检查）

发现问题就自己改，不要等用户跑起来才发现。

## Step 5 · 引导用户下一步

产出完成后简短告诉用户：

1. 两个文件的相对路径
2. 在 `/settings/datasets` 刷新即可看到（服务端每次 list 调用都扫目录）
3. 如果这个数据集是为某个评测任务准备的，**建议接下来调用 `/evalyst-task`** 来创建对应的评测任务（skill 会帮你校验 `inputs[].dataset_id` 指向已存在的数据集）。

## 不在本 skill 范围内

- 编辑已有数据集：让用户直接对话说「把 xxx 数据集的 yyy 字段改成 zzz」，Claude 读 + Edit 即可，不需要走 skill
- seed 数据集（如 `qa_pairs`）的修改：它们的源在 `src/lib/seeds/`，直接改 seed 源 + 删除 `data/datasets/` 下对应文件让 ensureSeeds 重新生成
- 数据集删除：让用户在 UI 上删或直接 `rm data/datasets/{id}.*`

