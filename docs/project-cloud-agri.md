# 云农智能体 — 项目详细介绍

## 一、项目概述

**云农智能体**是一个面向种植户和农业科研人员的垂直领域智能问答系统。它解决的核心问题是：**通用大模型（如 ChatGPT、通义千问）在农业场景下存在专业知识不足、回答缺乏来源、无法解读田间图像的问题**。

项目基于 **Spring Boot 3.5 + LangChain4j + pgvector** 构建，采用 ReAct Agent 多工具编排架构，通过阿里云 DashScope（Qwen-Max）大模型驱动，与植物表型分析平台联动，形成"图像感知 → 参数提取 → 知识检索 → 诊断报告"的完整闭环。

**举个例子**：种植户拍了一张水稻叶片发黄的照片，系统会（1）调用表型平台分析 NDVI/株高等参数 →（2）与正常标准比对判断是否异常 →（3）在病害图谱中检索匹配的症状和防治方案 →（4）生成一份带来源引用的诊断报告。整个过程由 Agent 自主决策执行，用户只需要发一张图片。

---

## 二、技术架构

### 2.1 四层架构

```
接入层（Controller）  →  编排层（ReAct Agent）  →  工具层（Tool + Skill 双模式）  →  数据层（pgvector / Redis / 表型API）
```

| 层 | 职责 | 核心组件 |
|------|------|----------|
| **接入层** | 接收用户请求，返回结构化事件流 | `AiChatController` — 5个端点：同步对话、SSE多事件流式对话、图像联动诊断、知识入库、文档上传 |
| **编排层** | Agent + Skill 双模式，自主决策 + 固定链执行 | `AiChatService` 组装 Agent；Skill 系统处理高频标准操作 |
| **工具层** | 5个农业 Tool + 通用 Tool + MCP 动态工具 | T1~T5 五个农业工具 + TimeTool + RagTool + MCP 天气等服务 |
| **数据层** | 混合检索、会话记忆、外部平台 | pgvector（向量+关键词双路）、Redis、表型平台 HTTP API |

### 2.2 请求处理流程（以"水稻叶片发黄怎么办"为例）

```
用户提问 "水稻叶片发黄怎么办"
  ↓
Controller 接收，设置监控上下文（ThreadLocal 传递 userId/sessionId）
  ↓
SafeInputGuardrail 输入安全检查（过滤敏感词）
  ↓
Agent 收到问题，开始 ReAct 思考循环：
  ┌─────────────────────────────────────────────┐
  │ Think：用户问的是症状诊断，应该查病害图谱    │
  │ Act：调用 T2（病害图谱查询工具）              │
  │       → T2 内部走混合检索：BM25 精确命中     │
  │         "叶片发黄" + 向量语义召回，           │
  │         Reranker 融合排序后返回 Top-5          │
  │ Observe：返回 3 条匹配结果（稻瘟病 0.92 /     │
  │          白叶枯 0.85 / 缺氮 0.78）            │
  │ Think：稻瘟病匹配度最高，还需查防治建议       │
  │ Act：调用 T1（农业知识检索），查稻瘟病防治     │
  │ Observe：返回防治方案                          │
  │ Think：信息足够了，可以组织回答               │
  │ Answer：生成结构化诊断报告                     │
  └─────────────────────────────────────────────┘
  ↓
ResponseValidator 第一道检查：格式校验（毫秒级）
  └→ 通过 → 直接返回
  └→ 涉及农业建议但无来源 → 追加安全提醒
  └→ 涉及农药用量等高风险建议 → 触发 Evaluator Agent 内容审查
       ┌─────────────────────────────────────────┐
       │ Evaluator Agent 逐条对照检索原文验证：   │
       │  ✓ 防治方案第三条与原文一致              │
       │  ✗ 来源标注"第99页"不存在（原文仅3页）    │
       │  ✗ 缺少"咨询农技人员"安全提醒            │
       │  → 发回生成 Agent 修正 → 再审查 → 通过   │
       └─────────────────────────────────────────┘
  ↓
SSE 结构化事件流返回前端：
  [thinking] → [tool_call] → [tool_result] → [message] → [message]
  （前端根据事件类型做不同渲染）
  ↓
返回给用户
```

---

## 三、核心技术实现

### 3.1 ReAct Agent 编排

项目采用 LangChain4j 的 `AiServices` 机制，通过**接口 + 注解**声明一个 Agent：

```java
public interface AiChat {
    @SystemMessage(fromResource = "system-prompt/agriculture-expert.txt")
    @InputGuardrails({SafeInputGuardrail.class})
    String chat(@MemoryId Long sessionId, @UserMessage String prompt);
}
```

LangChain4j 在运行时生成这个接口的代理对象，把 `@SystemMessage`（系统提示词）、`@MemoryId`（会话 ID）、`@UserMessage`（用户输入）和注册的 Tool + Skill 全部组装成一个能自主推理的 Agent。

**核心组装过程**（`AiChatService`）：

```
AiServices.builder(AiChat.class)
    .chatModel(chatModel)              // 绑定 LLM（Qwen-Max）
    .streamingChatModel(...)            // 绑定流式 LLM
    .contentRetriever(...)              // 默认检索器（非 Tool 路径回退）
    .chatMemoryProvider(...)            // 会话记忆（Redis，最近10轮）
    .tools(T1, T2, T3, T4, T5, ...)    // 注册 7 个工具
    .toolProvider(mcpToolProvider)      // MCP 动态工具发现
    .build()
```

**关键设计决策**：Agent 不是硬编码的 if-else 流程，而是让 LLM 自己读每个 Tool 的 `@Tool` 注解里的描述，判断"当前需要哪个工具、传什么参数"。这意味着新增一个工具只需要加一个 `@Tool` 注解的类，不需要改任何流程代码。

### 3.2 Tool + Skill 双模式

系统提供了两种执行模式，各司其职：

| 模式 | 执行方式 | 适用场景 | 举例 |
|------|----------|----------|------|
| **Tool 模式** | LLM 自主判断：要不要调、什么时候调、调几次 | 低频、灵活、需要推理的问答 | "水稻叶子发黄怎么办" → Agent 自主决定调 T2 还是 T1 |
| **Skill 模式** | 固定执行链：不依赖 LLM 逐步推理，按预定顺序执行 | 高频、标准、流程固定的操作 | "分析这张水稻图片" → Skill 直接按 T5→T4→T2 执行 |

**为什么需要 Skill**：ReAct Agent 每一步都要 LLM 思考"下一步调哪个工具"，存在两个问题——（1）每一步思考都消耗 Token；（2）LLM 可能选错工具导致诊断链路断裂。对于"水稻图片诊断"这种高频标准操作，确定性比灵活性更重要。Skill 把这个流程固化为执行链，LLM 只做一次决策（判断用户意图是不是"水稻图片诊断"），然后 Skill 内部三步走完，一步到位返回诊断报告。

**Tool 和 Skill 的共存逻辑**：Tool 给 Agent 发挥空间，Skill 给业务兜底。高频标准操作用 Skill 保证确定性，低频灵活问答用 Tool 保证灵活性。两者不是替代关系，是互补关系。

### 3.3 五类农业专用工具

| 工具 | 检索范围 | 过滤条件 | 使用场景 |
|------|----------|----------|----------|
| **T1 农业知识检索** | 通用农艺知识 | `domain=agronomy` | "水稻分蘖期怎么管理" |
| **T2 病害图谱查询** | 病害症状/防治 | `domain=plant_protection` + `source_type=disease_atlas` + `crop_type` | "叶片有褐色斑点是什么病" |
| **T3 种植规范查询** | 地域化种植规程 | `source_type=manual` + `crop_type` | "四川盆地水稻播种时间" |
| **T4 表型标准查询** | 指标正常范围 | `source_type=phenomics_standard` | "NDVI 0.45 正不正常" |
| **T5 表型分析调用** | HTTP 调用外部平台 | 无过滤（非检索型） | "分析这张图片的作物长势" |

T1-T4 是**检索型工具**，核心逻辑相同但过滤条件不同：
1. 把用户输入向量化（1024 维）
2. 在 pgvector 中执行**混合检索**（见 3.5 节）：先按元数据过滤 → 同时走向量语义召回 + BM25 关键词召回 → Reranker 融合排序 → 返回 Top-5

T5 是**调用型工具**，通过 RestTemplate 调用外部植物表型分析平台 API，获取 NDVI、株高、覆盖度等结构化数据。

**为什么分成四个工具而不是一个**：每种资料的查法不同。病害图谱要限定 `disease_atlas`，种植规程要限定 `manual`。如果用一个通用工具，LLM 可能不知道该加什么过滤条件，召回结果会混杂。拆开后，每个 Tool 的描述精确告诉 LLM 它做什么，Agent 选择正确的工具 = 自动选择了正确的过滤条件。

### 3.4 RAG 知识库

#### 3.4.1 存储结构

使用 PostgreSQL + pgvector 扩展，每张表有 4 列：

| 列名 | 类型 | 作用 |
|------|------|------|
| `embedding_id` | UUID | 主键 |
| `embedding` | VECTOR(1024) | 文本的向量表示，用于向量相似度计算 |
| `text` | TEXT | 原始文本内容（给 LLM 看的；同时建立 tsvector 索引用于 BM25） |
| `metadata` | JSONB | 7 个元数据字段，用于标量过滤和溯源 |

**metadata JSONB 里存什么**：

```json
{
  "domain": "plant_protection",
  "crop_type": "rice",
  "source_type": "disease_atlas",
  "source_doc": "水稻病害图谱",
  "page_num": "3",
  "publish_year": "2024",
  "chunk_id": "rice_disease_blast_001"
}
```

pgvector 的妙处在于：向量和元数据存在**同一张表**里，一条 SQL 就完成了"过滤 + 向量匹配"：
```sql
SELECT * FROM agriculture_knowledge
WHERE metadata @> '{"source_type": "disease_atlas", "crop_type": "rice"}'  -- 标量过滤（先执行）
ORDER BY embedding <=> '[0.12, -0.34, ...]'  -- 向量距离排序（后执行）
LIMIT 5;
```

#### 3.4.2 文档切分策略 + 上传即入库

不同类型的农业资料，切分方式不同。系统采用**策略模式**组织四种切分算法：

| 资料类型 | 切分策略 | 切分规则 | 设计原因 |
|----------|----------|----------|----------|
| **学术论文** | 语义段落策略 | ~800字/块，100字重叠，按段落边界切分 | 论文有上下文依赖，不能切断逻辑推理链 |
| **种植规程** | 章节标题策略 | 按章节标题切分（"第一章 整地"、"第二章 播种"），每个章节一个块 | 每个农事环节是独立的知识单元 |
| **病害图谱** | 病害名称策略 | 按病害名称标记切分（"【稻瘟病】"→ 下一个标记前），每个病害一个完整块 | 一个病害 = 一个包含症状+发病条件+防治方案的完整记录 |
| **表型标准** | 指标名称策略 | 按指标名标记切分（"【NDVI】"→ 下一个标记前），每个指标一个块 | 一个指标 = 一个完整的参考范围和解读 |

后端定义了统一的切分接口，四种策略各自实现，新增文档类型不需要改老代码。

**完整入库链路**：

```
用户上传 Markdown 文件 + 选择类型（下拉框：病害图谱/种植规程/论文/表型标准）
  → /api/documents/upload 接收
  → 策略工厂根据类型选择对应切分策略
  → 自动切分为 N 个 chunk，每个绑定元数据（domain/crop_type/source_type/source_doc/page_num/chunk_id）
  → 逐条向量化（EmbeddingModel.embed() → 1024维向量）
  → 写入 pgvector（同时更新 BM25 索引）
  → 入库完成，无需重启服务
```

Python 脚本预切分 + 启动加载（`RagDataLoader`）作为冷启动方案；运行时上传接口（`/api/documents/upload`）作为热更新方案。两者互补，知识库从"静态快照"变成"持续生长的活系统"。

#### 3.4.3 运行时知识写入

除了上传文档，系统还支持通过接口直接写入单条知识：

```
POST /api/insert  body: { question: "怎么防治稻飞虱", answer: "...", sourceName: "水稻病虫害防治手册" }
```

系统同步写入本地 Markdown 文件和 pgvector，不需要重启服务。

### 3.5 混合检索（向量 + BM25 双路召回）

纯向量搜索存在一个关键短板：**语义相近但含义不同的专有名词容易混淆**。

**具体例子**："三环唑"、"三唑酮"、"丙环唑"是三种不同的农药，化学结构和用途不同。但向量模型把它们都理解为"唑类杀菌剂"，向量距离非常接近。用户搜"三环唑怎么用"，纯向量搜索可能把"三唑酮的使用方法"排在"三环唑防治稻瘟病技术"前面——因为向量模型觉得它们语义很接近。

**解决方案**：双路召回 + Reranker 融合排序。

```
用户问题 "三环唑怎么用"
        │
        ├─→ 向量化 → pgvector cosine 距离排序
        │   召回：三唑酮(0.91)、丙环唑(0.88)、三环唑(0.85)
        │         （语义相近的都回来了）
        │
        └─→ 分词 → PostgreSQL ts_rank + to_tsvector 全文搜索
            召回：三环唑(0.95)、稻瘟病(0.72)、杀菌剂(0.60)
                  （精确匹配"三环唑"的排前面）
        │
        └─→ Reranker（Cross-Attention 模型）融合双路结果
            最终排序：三环唑防治稻瘟病(0.93)、三环唑使用说明(0.89)...
                      （精确匹配 + 语义相关，取各自长处）
```

**两种搜索的互补关系**：
- 向量搜索：理解语义，口语化描述也能匹配到专业内容（"叶子发黄"匹配到"叶片黄化"）
- BM25 关键词搜索：精确匹配专有名词，不会把"三环唑"和"三唑酮"搞混

pgvector 表在 `text` 列上额外建立了 `tsvector` 索引，双路检索在同一个 PostgreSQL 实例中完成，不需要引入额外的搜索引擎。

### 3.6 会话记忆管理

使用 Redis 存储多轮对话历史。LangChain4j 的 `MessageWindowChatMemory` 维护一个滑动窗口（最近 10 轮），通过 `RedisChatMemoryStore` 持久化。

**为什么是 10 轮而不是更多**：轮次越多，Prompt 越长 → Token 消耗越大 → 响应越慢。10 轮是在"保留足够上下文"和"控制成本"之间的平衡点。同时 Redis 设置了 30 分钟 TTL，闲置会话自动清理。

### 3.7 溯源与幻觉控制（三层防线 + 双 Agent 互审）

大模型的固有问题：会生成看起来很合理但实际上不存在的"知识"。系统从三个层次做防御，并引入了 Evaluator Agent 做内容级审查：

| 层次 | 机制 | 做法 | 耗时 |
|------|------|------|------|
| **入库层** | 元数据绑定 | 每个 chunk 标注 `source_doc`、`page_num`、`chunk_id` | — |
| **生成层** | 系统提示词约束 | 要求回答标注 `【来源：xxx 第x页】`，知识不足声明无法确认 | — |
| **后处理-格式** | ResponseValidator 正则校验 | 检查涉农业建议是否引用来源，无来源追加安全提醒 | 毫秒级 |
| **后处理-内容** | Evaluator Agent 审查 | 逐条对照检索原文验证事实、来源真伪、安全提醒完整性 | 秒级 |

**Evaluator Agent 的审查逻辑**（Reflexion 模式）：

```
生成 Agent 输出回答
  ↓
Evaluator Agent 做三件事：
  1. 事实核查：将回答中的每条建议与检索到的原文逐条对照
     "防治方案第三条写的是'控氮增磷钾'，原文是'控氮增磷钾' ✓"
     "你写的'多施氮肥'，原文是'控氮'——对不上 ✗"
  2. 来源验证：检查来源标注是否真实存在
     "标注'水稻病害图谱 第99页'，原文只有3页——来源不存在 ✗"
  3. 安全审查：检查是否缺少必要的安全提醒
     "涉及农药用量，未加'咨询农技人员'提醒 ✗"
  ↓
发现问题 → 带着反馈发回生成 Agent 修正 → 再审查
  ↓
最多三轮，通过则返回，不通过则降级：在回答末尾追加免责声明后返回
```

**为什么不是取代 ResponseValidator，而是分层**：ResponseValidator 做第一道格式检查——毫秒级，零 Token 消耗，100% 的回答都走。Evaluator Agent 做第二道内容审查——需要调一次 LLM，有 Token 消耗，只对涉农药/施肥等高风险回答触发。大部分日常问答第一道就过了，只有真正需要内容核验的重要回答才走第二道。这是在安全性和成本之间的工程化平衡。

### 3.8 流式输出（SSE 多事件结构）

同步接口（`/chat`）等 AI 想完再一次性返回。流式接口（`/streamChat`）实时推送，并且不是纯文字流，而是带事件类型的结构化推送：

```
前端收到的 SSE 事件流：

event: thinking
data: {"content": "正在分析用户描述的叶片症状..."}

event: tool_call
data: {"toolName": "DiseaseAtlasTool", "params": {"symptom": "叶片发黄", "cropType": "rice"}}

event: tool_result
data: {"toolName": "DiseaseAtlasTool", "resultCount": 3, "topScore": 0.92}

event: message
data: {"content": "【初步判断】根据您描述的水稻叶片发黄症状...", "metadata": {"sources": [...]}}

event: message
data: {"content": "【处理建议】1. 合理施肥...", "metadata": {"sources": [...]}}
```

| 事件类型 | 含义 | 前端渲染建议 |
|----------|------|-------------|
| `thinking` | Agent 正在推理 | 灰色思考提示，带加载动画 |
| `tool_call` | 正在调用工具 | "正在检索知识库…"进度条 |
| `tool_result` | 工具返回结果 | 展示检索命中数和最高相似度 |
| `message` | 最终回答内容 | 正常文字渲染，带来源标注 |
| `error` | 异常 | 红色错误提示 |

技术实现：`SSEEvent` 类定义了 5 种事件类型，Controller 返回 `Flux<SSEEvent>` 结构化事件流。底层基于 Spring WebFlux 的响应式流，前端以 `text/event-stream` 接收。

**和普通纯文字流式的区别**：纯文字流前端只能看到一个 token 接一个 token 蹦出来，不知道哪段是思考、哪段是查资料、哪段是回答。结构化事件流让前端能区分"系统在干什么"，用户看到的不是黑盒。

### 3.9 监控体系

| 组件 | 职责 |
|------|------|
| `AiModelMetricsCollector` | 通过 Micrometer 向 Prometheus 暴露4类指标：请求次数、Token 消耗（区分 input/output）、错误次数、响应时长 |
| `AiModelMonitorListener` | 实现 LangChain4j 的 `ChatModelListener` 接口，在每次 LLM 调用的 `onRequest`/`onResponse`/`onError` 生命周期钩子中触发指标采集 |
| `MonitorContextHolder` | `ThreadLocal` 传递 userId/sessionId，确保每条指标都带上用户维度。在 Reactor 线程中用 `Flux.defer` + `doFinally` 确保正确传递和清理 |
| Prometheus + Grafana | 指标可视化（`/api/actuator/prometheus` 暴露指标端点，`system-prompt/prometheus.yml` 提供 Prometheus 抓取配置） |

### 3.10 安全守卫

`SafeInputGuardrail` 实现 LangChain4j 的 `InputGuardrail` 接口，在用户输入进入 Agent 之前进行敏感词过滤。`@InputGuardrails` 注解在 AiChat 接口上，LangChain4j 自动在每次调用时触发。这是**请求级**的安全防护，对所有 Agent 调用生效。

### 3.11 MCP 协议集成农业服务

系统已集成 MCP（Model Context Protocol）能力。工具扩展方式从"写 Java 代码 → 重新部署"变成了"连接一个 MCP Server → Agent 自动发现工具"。

**当前已接入**：智谱 BigModel 网页搜索 MCP Server（通过 HTTP SSE 传输）。

**已设计接入的农业专用 MCP 服务**：
- **天气数据 MCP Server**：提供实时天气和预报数据。用户问"明天北京下雨能喷药吗"，Agent 自动调天气工具查到"明天中雨" + 调病害图谱查到"雨天喷药会被冲刷，建议雨后补喷" → 融合回答"明天有雨，建议推迟到雨后，如果已喷则雨后补喷一次"
- **土壤数据 MCP Server**：提供土壤墒情、养分数据。结合表型分析和土壤数据给出更精准的施肥建议

**MCP 的架构价值**：工具不再是写死在代码里的。外部服务只要实现 MCP Server 协议（基于 JSON-RPC），Agent 就能动态发现和调用。服务的提供方和消费方解耦——农业数据服务方不需要了解 AI Agent 的内部实现，AI Agent 也不需要为每个新数据源写一个 Java 类。

---

## 四、系统亮点总结

### 4.1 两阶段检索

不是简单的向量匹配，而是**标量过滤 + 向量召回**在同一 SQL 中完成。先用 JSONB 的 `@>` 运算符过滤元数据（如只看水稻病害相关 chunk），再对过滤结果做向量距离排序。这保证了召回的内容既有语义相关性，又有领域准确性。

### 4.2 差异化文档切分 + 策略模式

不是所有文档用同一种切分方式。病害图谱一个病害一个块，论文按语义段落切分，规程按农事环节切分。四种策略各自实现统一的切分接口，加新资料类型不需要改老代码。配合上传接口实现运行时入库，知识库不再是静态快照。

### 4.3 ReAct 多工具编排 + Skill 双模式

5 个农业专用 Tool 由 Agent 自主决策调用。同时引入 Skill 系统，高频标准操作（如图片诊断）固化为固定执行链，不依赖 LLM 逐步推理，降低 Token 消耗和选错概率。Tool 保证灵活性，Skill 保证确定性。

### 4.4 BM25 + 向量混合检索

向量搜索理解语义（"叶子发黄"匹配到"叶片黄化"），BM25 关键词搜索精确命中专有名词（"三环唑"不会混淆为"三唑酮"）。双路召回 + Reranker 融合排序，取各自长处。

### 4.5 三层幻觉控制 + Evaluator Agent

入库元数据 → 生成提示词约束 → 后处理正则校验（格式）→ Evaluator Agent 内容审查（事实+来源+安全）。ResponseValidator 做毫秒级格式检查覆盖全部回答，Evaluator Agent 做秒级内容审查覆盖高风险回答。工程化平衡了安全性和成本。

### 4.6 SSE 多事件结构化流式

不是纯文字流，而是 thinking / tool_call / tool_result / message / error 五种结构化事件。前端可以根据事件类型做不同渲染，用户能感知到"系统在干什么"而不是看文字从黑盒里蹦出来。

### 4.7 MCP 动态工具扩展

工具不再是写死在代码里的。天气、土壤等外部农业数据服务只需实现 MCP Server 协议，Agent 就能自动发现和调用。服务的提供方和消费方彻底解耦。

### 4.8 完整的监控 + 安全体系

Micrometer + Prometheus 量化追踪 Token 消耗和响应质量。InputGuardrail 输入级安全防护。`ThreadLocal` + Reactor 线程传递机制确保监控上下文在异步环境中不丢失。

---

## 五、技术栈一览

| 层次 | 技术选型 | 说明 |
|------|----------|------|
| **框架** | Spring Boot 3.5 | Java 17 |
| **AI 框架** | LangChain4j | AI Services / @Tool / Guardrail / ChatMemory / ChatModelListener |
| **大模型** | 阿里云 DashScope Qwen-Max | 通过 LangChain4j 适配器调用 |
| **向量模型** | text-embedding-v4 | 1024 维 |
| **向量库** | pgvector | PostgreSQL 扩展，VECTOR(1024) + JSONB + tsvector 同表存储 |
| **关键词检索** | PostgreSQL ts_rank + to_tsvector | 与 pgvector 共处同一实例，无需额外搜索引擎 |
| **Reranker** | Cross-Attention 模型 | 双路召回融合排序 |
| **会话记忆** | Redis | MessageWindowChatMemory，最近10轮，30分钟 TTL |
| **流式输出** | Spring WebFlux + SSE | Reactor `Flux<SSEEvent>` 结构化多事件流 |
| **监控** | Micrometer + Prometheus + Grafana | 请求次数/Token消耗/错误次数/响应时长 |
| **工具扩展** | MCP 协议 | 已接入网页搜索，已设计天气/土壤等农业专用 Server |
| **部署** | Docker | 端口 10010，context-path `/api` |

---

## 六、API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat` | 同步对话，返回完整回答（ResponseValidator 后处理） |
| POST | `/api/streamChat` | SSE 流式对话，5 种事件类型结构化推送 |
| POST | `/api/diagnosis` | 图像联动诊断（流式），Skill 或 Prompt 引导 T5→T4→T2 链路 |
| POST | `/api/insert` | 运行时追加单条知识点，同步写入文件和 pgvector |
| POST | `/api/documents/upload` | 上传 Markdown 文档，自动按类型切分并入库 |

---

## 七、项目定位与价值

这个项目不是对通用大模型 API 的简单封装。它的核心价值在于：

1. **垂直领域知识管理**：从文档切分策略 → 元数据建模 → 混合检索（向量+BM25）→ Reranker 融合排序，全链路解决了"农业知识如何被 AI 有效利用"的问题
2. **Agent 自主决策**：不是写死的问答流程。Agent 根据用户意图自主选择工具组合，体现了 AI 应用的工程化设计能力
3. **Tool + Skill 双模式**：灵活性和确定性各有归属，高频操作用 Skill 兜底，低频问答用 Tool 发挥
4. **幻觉控制工程化**：四道防线的分层设计——格式检查毫秒级全覆盖，内容审查按需触发高风险回答——体现了对 LLM 能力边界的清醒认知和工程化的安全成本平衡
5. **MCP 动态扩展**：工具的提供方和消费方解耦，农业数据服务独立演进，Agent 自动发现
6. **可运营性**：运行时知识写入、文档上传即入库、流式多事件推送、完整监控指标，不是 Demo 级别的功能演示，而是面向真实用户的系统设计
