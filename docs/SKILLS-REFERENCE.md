# Skills & Agents — Quick Reference

A comprehensive reference for every skill/agent you can invoke — either via the `Skill` tool (text guidance) or the `Agent` tool (fresh worker).

---

## Contents

| Section | Skills count |
|---|---|
| [Process (planning & building)](#process--planning--building) | 15 |
| [ECC AI agents & tools](#ecc-ai-agents--tools-spawn-a-fresh-worker) | ~290 |
| [Cloud-Ops / Security skills](#cloud-ops--security-skills) | ~309 |
| [Hyperframes skills](#hyperframes-skills) | ~305 |
| [Context-mode tools](#context-mode-tools) | ~44 |
| [UI/UX Pro Max](#uix-pro-max) | 3 |
| [Karpathy guidelines](#karpathy-guidelines) | 1 |
| [Trailofbits](#trailofbits) | 43 |
| [Frontend design](#frontend-design) | 1 |
| [User-level skills](#user-level-skills) | 37 |
| [MCP servers](#mcp-servers) | — |
| [Built-in / harness tools](#built-in--harness-tools) | — |
| [Quick lookup by task](#quick-lookup-by-task) | — |


## Process — planning & building

| Skill | Use case |
|---|---|
| `brainstorming` | Ask 'what do you actually want and why?' before building. Turns half-formed ideas into a plan via conversation. |
| `writing-plans` | After brainstorming is approved, writes a full step-by-step implementation plan. |
| `systematic-debugging` | Triages a bug: reproduce → isolate → fix → verify. Use before code-review on a bug fix. |
| `test-driven-development` | Write the failing test first, then the code; run tests before saying done. |
| `verification-before-completion` | Final pass: did tests run? did checks pass? show the result. |
| `using-superpowers` | Meta-skill: 'did I check for a relevant skill before acting?' Always-on. |
| `diagnosing-superpowers` | Use when a superpowers session went wrong and your human partner wants to know why. |
| `dispatching-parallel-agents` | Fan out multiple agents in one pass for independent tasks. |
| `executing-plans` | Execute an already-written plan through agents. |
| `finishing-a-development-branch` | Wrap-up checklist for a dev branch before PR. |
| `receiving-code-review` | Process for receiving/applying review feedback. |
| `requesting-code-review` | How to ask for a review properly. |
| `subagent-driven-development` | Drive implementation through subagents. |
| `writing-skills` | How to write a new skill. |


### Superpowers Lab

| Skill | Use case |
|---|---|
| `finding-duplicate-functions` | Audit a codebase for semantic duplication — functions that do the same thing but have different names or implementations. |
| `mcp-cli` | Use MCP servers on-demand via the mcp CLI tool — discover tools, resources, and prompts without polluting context. |
| `using-tmux-for-interactive-commands` | Run interactive CLI tools (vim, git rebase -i, Python REPL, etc.) that require real-time input/output. |
| `windows-vm` | Create, manage, or connect to a headless Windows 11 VM running in Docker with SSH access. |
| `categorize-prompt` | Categorize and tag prompts for reuse and retrieval. |
| `find-duplicates-prompt` | Detect duplicate prompts across projects. |


## ECC AI agents & tools (spawn a fresh worker)

Invoke any of these via `/<skill-name>` to spawn a specialized worker agent. Each agent type runs with its own model config and tool set.


### Categories

| Category | Count |
|---|---|
| [Code review & analysis](#code-review--analysis) | ~40 |
| [Build & error resolution](#build-error-resolution) | ~25 |
| [Testing](#testing) | ~25 |
| [Frontend & UI](#frontend--ui) | ~20 |
| [Backend & databases](#backend--databases) | ~15 |
| [DevOps & infrastructure](#devops--infrastructure) | ~10 |
| [Security](#security) | ~10 |
| [AI & agent tooling](#ai--agent-tooling) | ~20 |
| [Documentation & specs](#documentation--specs) | ~15 |
| [Productivity & business](#productivity--business) | ~15 |


### Code review & analysis

| Skill | Use case |
|---|---|
| `ecc:agent-architecture-audit` | Full-stack diagnostic for agent and LLM applications. Audits the 12-layer agent stack for wrapper regression, memory pollution, tool discipline failures, hidden repair loops, and rendering corruption. |
| `ecc:android-clean-architecture` | Clean Architecture patterns for Android and Kotlin Multiplatform projects — module structure, dependency rules, UseCases, Repositories, and data layer patterns. Use when structuring modules, layers, o |
| `ecc:architecture` |  |
| `ecc:architecture-decision-records` | Capture architectural decisions as numbered ADR markdown files in docs/adr/ with context, alternatives considered, consequences, and an index README. Use when the user says 'record this decision' or ' |
| `ecc:automation-audit-ops` | Evidence-first automation inventory and overlap audit workflow for ECC. Use when the user wants to know which jobs, hooks, connectors, MCP servers, or wrappers are live, broken, redundant, or missing  |
| `ecc:click-path-audit` | Trace every user-facing button/touchpoint through its full state change sequence to find bugs where functions individually work but cancel each other out, produce wrong final state, or leave the UI in |
| `ecc:ecc-tools-cost-audit` | Evidence-first ECC Tools burn and billing audit workflow. Use when investigating runaway PR creation, quota bypass, premium-model leakage, duplicate jobs, or GitHub App cost spikes in the ECC Tools re |
| `ecc:flutter-dart-code-review` | Library-agnostic Flutter/Dart code review checklist covering widget best practices, state management patterns (BLoC, Riverpod, Provider, GetX, MobX, Signals), Dart idioms, performance, accessibility,  |
| `ecc:hexagonal-architecture` | Design, implement, and refactor Ports & Adapters systems with clear domain boundaries, dependency inversion, and testable use-case orchestration across TypeScript, Java, Kotlin, and Go services. Use w |
| `ecc:plankton-code-quality` | Write-time code quality enforcement using Plankton — auto-formatting, linting, and Claude-powered fixes on every file edit via hooks. Use when setting up write-time formatting, linting, or auto-fix ho |
| `ecc:prediction-market-risk-review` | Review prediction-market, basket, oracle, and trading-agent workflows for compliance, safety, data-quality, privacy, and execution risk. Use before any workflow handles venue auth, user portfolio data |
| `ecc:production-audit` | Local-evidence production readiness audit for shipped apps, pre-launch reviews, post-merge checks, and "what breaks in prod?" questions without sending repo data to an external audit service. Use when |
| `ecc:quality-nonconformance` | Quality control and non-conformance management for regulated manufacturing (FDA 21 CFR 820, IATF 16949, AS9100): NCR lifecycle and disposition, 5-Why/Ishikawa/fault-tree/8D root cause analysis, CAPA s |
| `ecc:recsys-pipeline-architect` | Design composable recommendation, ranking, and feed pipelines using the six-stage Source→Hydrator→Filter→Scorer→Selector→SideEffect framework popularized by xAI's open-sourced For You algorithm. Use t |
| `ecc:scientific-thinking-literature-review` | Systematic literature-review workflow for academic, biomedical, technical, and scientific topics, including search planning, source screening, synthesis, citation checks, and evidence logging. Use whe |
| `ecc:security-review` | Use this skill when adding authentication, handling user input, working with secrets, creating API endpoints, or implementing payment/sensitive features. Provides comprehensive security checklist and  |
| `ecc:workspace-surface-audit` | Audit the active repo, MCP servers, plugins, connectors, env surfaces, and harness setup, then recommend the highest-value ECC-native skills, hooks, agents, and operator workflows. Use when the user w |


### Build & error resolution

| Skill | Use case |
|---|---|
| `ecc:api-connector-builder` | Build a new API connector or provider by matching the target repo's existing integration pattern exactly. Use when adding one more integration without inventing a second architecture. |
| `ecc:dashboard-builder` | Build monitoring dashboards that answer real operator questions for Grafana, SigNoz, and similar platforms. Use when turning metrics into a working dashboard instead of a vanity board. |
| `ecc:data-resolvers` |  |
| `ecc:error-handling` |  |
| `ecc:orch-build-mvp` | Orchestrate bootstrapping a working MVP from a design or spec document — ingest the SDD/PRD, plan thin vertical slices, scaffold the first end-to-end slice, then drive a generator-evaluator build loop |
| `ecc:orch-fix-defect` | Orchestrate fixing a bug — reproduce it as a failing regression test, fix to green, review, and gated commit — by delegating each phase to the matching ECC agent. Use when existing behavior is broken  |
| `ecc:team-builder` | Interactive picker that discovers available agent personas via the claude agents command and agents/ markdown globs, groups them into domains, has the user select up to five, dispatches them in parall |


### Testing

| Skill | Use case |
|---|---|
| `ecc:ai-regression-testing` | Regression testing strategies for AI-assisted development. Sandbox-mode API testing without database dependencies, automated bug-check workflows, and patterns to catch AI blind spots where the same mo |
| `ecc:cpp-testing` | Use only when writing/updating/fixing C++ tests, configuring GoogleTest/CTest, diagnosing failing or flaky tests, or adding coverage/sanitizers. |
| `ecc:csharp-testing` | C# and .NET testing patterns with xUnit, FluentAssertions, mocking, integration tests, and test organization best practices. Use when writing or reviewing xUnit tests, mocks, or integration tests in a |
| `ecc:django-tdd` | Django testing strategies with pytest-django, TDD methodology, factory_boy, mocking, coverage, and testing Django REST Framework APIs. Use when writing Django or DRF tests with pytest-django, or drivi |
| `ecc:e2e-testing` |  |
| `ecc:fsharp-testing` | F# testing patterns with xUnit, FsUnit, Unquote, FsCheck property-based testing, integration tests, and test organization best practices. Use when writing F# tests with xUnit, FsUnit, Unquote, or FsCh |
| `ecc:golang-testing` | Go testing patterns including table-driven tests, subtests, benchmarks, fuzzing, and test coverage. Follows TDD methodology with idiomatic Go practices. Use when writing Go tests — table-driven cases, |
| `ecc:kotlin-testing` | Kotlin testing patterns with Kotest, MockK, coroutine testing, property-based testing, and Kover coverage. Follows TDD methodology with idiomatic Kotlin practices. Use when writing Kotlin tests with K |
| `ecc:laravel-tdd` | Laravel testing strategies with PHPUnit, Pest, model factories, HTTP tests, Sanctum authentication testing, mocking, and coverage. Use when writing Laravel tests with PHPUnit or Pest, or driving a Lar |
| `ecc:perl-testing` | Perl testing patterns using Test2::V0, Test::More, prove runner, mocking, coverage with Devel::Cover, and TDD methodology. Use when writing Perl tests with Test2::V0 or Test::More, or measuring covera |
| `ecc:python-testing` | Python testing strategies using pytest, TDD methodology, fixtures, mocking, parametrization, and coverage requirements. Use when writing pytest tests — fixtures, mocks, parametrization, or coverage. |
| `ecc:quarkus-tdd` | Test-driven development for Quarkus 3.x LTS using JUnit 5, Mockito, REST Assured, Camel testing, and JaCoCo. Use when adding features, fixing bugs, or refactoring event-driven services. |
| `ecc:react-testing` | React component testing with React Testing Library, Vitest/Jest, MSW for network mocking, accessibility assertions with axe, and the decision boundary between component tests and Playwright/Cypress en |
| `ecc:router-testing` |  |
| `ecc:rust-testing` | Rust testing patterns including unit tests, integration tests, async testing, property-based testing, mocking, and coverage. Follows TDD methodology. Use when writing Rust tests — unit, integration, a |
| `ecc:springboot-tdd` | Test-driven development for Spring Boot using JUnit 5, Mockito, MockMvc, Testcontainers, and JaCoCo. Use when adding features, fixing bugs, or refactoring. |
| `ecc:swift-protocol-di-testing` | Protocol-based dependency injection for testable Swift code — mock file system, network, and external APIs using focused protocols and Swift Testing. Use when Swift code needs testing and file system, |
| `ecc:tdd-workflow` | Test-driven development workflow: write a failing test first, watch it fail, implement the smallest change to green, then refactor with 80%+ coverage across unit, integration, and E2E tests. Use when  |
| `ecc:testing` |  |
| `ecc:testing-fundamentals` |  |
| `ecc:windows-desktop-e2e` | E2E testing for Windows native desktop apps (WPF, WinForms, Win32/MFC, Qt) using pywinauto and Windows UI Automation. Use when writing E2E tests for a Windows native desktop app with pywinauto or UI A |


### Frontend & UI

| Skill | Use case |
|---|---|
| `ecc:angular-animations` |  |
| `ecc:angular-aria` |  |
| `ecc:angular-developer` | Generates Angular code and provides architectural guidance. Trigger when creating projects, components, or services, or for best practices on reactivity (signals, linkedSignal, resource), forms, depen |
| `ecc:frontend-a11y` | Accessibility patterns for React and Next.js — semantic HTML, ARIA attributes, form labeling, keyboard navigation, focus management, and screen reader support. Use when building or reviewing forms, mo |
| `ecc:frontend-design-direction` | Set an ECC-specific frontend design direction for production UI work. Use when building or improving websites, dashboards, applications, components, landing pages, visual tools, or any web UI that nee |
| `ecc:frontend-patterns` | Frontend development patterns for React, Next.js, state management, performance optimization, and UI best practices. Use when building or reviewing React or Next.js components, state, or render perfor |
| `ecc:frontend-slides` | Create stunning, animation-rich HTML presentations from scratch or by converting PowerPoint files. Use when the user wants to build a presentation, convert a PPT/PPTX to web, or create slides for a ta |
| `ecc:nextjs-turbopack` | Next.js 16+ and Turbopack guidance — incremental Rust bundling, file-system caching, faster dev startup and HMR, Turbopack vs webpack tradeoffs, and the middleware.ts to proxy.ts filename change. Use  |
| `ecc:nuxt4-patterns` | Nuxt 4 app patterns for hydration safety, performance, route rules, lazy loading, and SSR-safe data fetching with useFetch and useAsyncData. Use when building or reviewing a Nuxt 4 app, or debugging h |
| `ecc:react-native-patterns` | React Native and Expo app patterns — Expo Router navigation, state separation (server/client/route/form), TanStack Query data fetching with Zod, performant lists, NativeWind/StyleSheet styling, native |
| `ecc:react-patterns` | React 18/19 patterns including hooks discipline, server/client component boundaries, Suspense + error boundaries, form actions, data fetching, state management decision trees, and accessibility-first  |
| `ecc:react-performance` | React and Next.js performance optimization patterns adapted from Vercel Engineering's React Best Practices (https://github.com/vercel-labs/agent-skills). Organizes 70+ rules across 8 priority categori |
| `ecc:react-testing` | React component testing with React Testing Library, Vitest/Jest, MSW for network mocking, accessibility assertions with axe, and the decision boundary between component tests and Playwright/Cypress en |
| `ecc:reactive-forms` |  |
| `ecc:swiftui-patterns` | SwiftUI architecture patterns, state management with @Observable, view composition, navigation, performance optimization, and modern iOS/macOS UI best practices. Use when building or reviewing SwiftUI |
| `ecc:ui-demo` | Record polished UI demo videos using Playwright. Use when the user asks to create a demo, walkthrough, screen recording, or tutorial video of a web application. Produces WebM videos with visible curso |
| `ecc:ui-to-vue` | Use when the user has UI screenshots or design exports that need batch conversion into Vue 3 components, especially with Vant, Element Plus, or Ant Design Vue. |
| `ecc:vue-patterns` | Vue.js 3 Composition API patterns, component architecture, reactivity best practices, Pinia state management, Vue Router navigation, and Nuxt SSR patterns. Activates for Vue, Nuxt, Vite, or Pinia proj |


### Backend & databases

| Skill | Use case |
|---|---|
| `ecc:api-connector-builder` | Build a new API connector or provider by matching the target repo's existing integration pattern exactly. Use when adding one more integration without inventing a second architecture. |
| `ecc:api-design` | REST API design patterns including resource naming, status codes, pagination, filtering, error responses, versioning, and rate limiting for production APIs. Use when designing or reviewing REST endpoi |
| `ecc:api-reference` |  |
| `ecc:backend-patterns` | Backend architecture patterns, API design, database optimization, and server-side best practices for Node.js, Express, and Next.js API routes. Use when building or reviewing Node.js, Express, or Next. |
| `ecc:database` |  |
| `ecc:database-migrations` | Safe, reversible database migration patterns: forward-only production changes, expand-contract zero-downtime renames, concurrent indexes, batched backfills, and per-tool workflows for PostgreSQL, Pris |
| `ecc:django-celery` | Django + Celery async task patterns — configuration, task design, beat scheduling, retries, canvas workflows, monitoring, and testing. Use when adding background jobs, scheduled tasks, or async proces |
| `ecc:django-patterns` | Django architecture patterns, REST API design with DRF, ORM best practices, caching, signals, middleware, and production-grade Django apps. Use when building or reviewing Django apps, DRF APIs, ORM qu |
| `ecc:django-security` | Django security best practices, authentication, authorization, CSRF protection, SQL injection prevention, XSS prevention, and secure deployment configurations. Use when reviewing Django authentication |
| `ecc:django-tdd` | Django testing strategies with pytest-django, TDD methodology, factory_boy, mocking, coverage, and testing Django REST Framework APIs. Use when writing Django or DRF tests with pytest-django, or drivi |
| `ecc:django-verification` | Run the full Django verification loop — environment check, mypy/ruff/black linting, migration safety, pytest with coverage targets, pip-audit and bandit security scans, settings and logging review, an |
| `ecc:fastapi-patterns` | FastAPI best practices covering project structure, Pydantic v2 schemas, dependency injection, async handlers, authentication, authorization, transactional service layers, and testing with httpx and py |
| `ecc:mysql-patterns` | MySQL and MariaDB schema, query, indexing, transaction, replication, and connection-pool patterns for production backends. Use when designing MySQL or MariaDB schemas and indexes, or when a query, tra |
| `ecc:postgres-patterns` | PostgreSQL database patterns for query optimization, schema design, indexing, and security. Based on Supabase best practices. Use when designing PostgreSQL schemas, indexes, or RLS policies, or when a |
| `ecc:redis-patterns` | Redis data structure patterns, caching strategies, distributed locks, rate limiting, pub/sub, and connection management for production applications. Use when adding caching, a distributed lock, rate l |
| `ecc:scientific-db-pubmed-database` | Direct PubMed and NCBI E-utilities search workflows for biomedical literature, MeSH queries, PMID lookup, citation retrieval, and API-backed literature monitoring. Use when a task needs biomedical lit |
| `ecc:scientific-db-uspto-database` | USPTO patent and trademark data workflow for official record lookup, PatentSearch queries, TSDR checks, assignment data, and reproducible IP research logs. Use when a task needs official United States |
| `ecc:x-api` | X/Twitter API integration for posting tweets, threads, reading timelines, search, and analytics. Covers OAuth auth patterns, rate limits, and platform-native content posting. Use when the user wants t |


### DevOps & infrastructure

| Skill | Use case |
|---|---|
| `ecc:cost-aware-llm-pipeline` | Cost optimization patterns for LLM API usage — model routing by task complexity, budget tracking, retry logic, and prompt caching. Use when LLM spend needs to come down, or when routing tasks across m |
| `ecc:deployment-patterns` | Deployment workflows, CI/CD pipeline patterns, Docker containerization, health checks, rollback strategies, and production readiness checklists for web applications. Use when setting up CI/CD, contain |
| `ecc:docker-patterns` | Docker and Docker Compose patterns for local development, hardened CLI installer harnesses, container security, networking, volumes, and multi-service orchestration. Use when creating or reviewing Doc |
| `ecc:kubernetes-patterns` | Kubernetes workload patterns, resource management, RBAC, probes, autoscaling, ConfigMap/Secret handling, and kubectl debugging for production-grade deployments. Use when writing or reviewing Kubernete |
| `ecc:opensource-pipeline` | Open-source pipeline: fork, sanitize, and package private projects for safe public release. Chains 3 agents (forker, sanitizer, packager). Triggers: '/opensource', 'open source this', 'make this publi |
| `ecc:orch-pipeline` | Shared orchestration engine behind the orch-* skill family — the gated Research-Plan-TDD-Review-Commit pipeline, size classifier, agent and command map, and two human gates (plan approval, commit conf |
| `ecc:ralphinho-rfc-pipeline` | Split an RFC into a multi-agent execution DAG — decompose into work units with dependencies and acceptance tests, run research, plan, implement, test, and review per unit, then merge through a queue w |
| `ecc:recsys-pipeline-architect` | Design composable recommendation, ranking, and feed pipelines using the six-stage Source→Hydrator→Filter→Scorer→Selector→SideEffect framework popularized by xAI's open-sourced For You algorithm. Use t |


### Security

| Skill | Use case |
|---|---|
| `ecc:agent-architecture-audit` | Full-stack diagnostic for agent and LLM applications. Audits the 12-layer agent stack for wrapper regression, memory pollution, tool discipline failures, hidden repair loops, and rendering corruption. |
| `ecc:automation-audit-ops` | Evidence-first automation inventory and overlap audit workflow for ECC. Use when the user wants to know which jobs, hooks, connectors, MCP servers, or wrappers are live, broken, redundant, or missing  |
| `ecc:click-path-audit` | Trace every user-facing button/touchpoint through its full state change sequence to find bugs where functions individually work but cancel each other out, produce wrong final state, or leave the UI in |
| `ecc:cloud-infrastructure-security` |  |
| `ecc:defi-amm-security` | Security checklist for Solidity AMM contracts, liquidity pools, and swap flows. Covers reentrancy, CEI ordering, donation or inflation attacks, oracle manipulation, slippage, admin controls, and integ |
| `ecc:django-security` | Django security best practices, authentication, authorization, CSRF protection, SQL injection prevention, XSS prevention, and secure deployment configurations. Use when reviewing Django authentication |
| `ecc:ecc-tools-cost-audit` | Evidence-first ECC Tools burn and billing audit workflow. Use when investigating runaway PR creation, quota bypass, premium-model leakage, duplicate jobs, or GitHub App cost spikes in the ECC Tools re |
| `ecc:laravel-security` | Laravel security best practices — authentication, authorization, Eloquent safety, CSRF, XSS prevention, API security, and secure deployment configurations. Use when reviewing Laravel auth, Eloquent sa |
| `ecc:llm-trading-agent-security` | Security patterns for autonomous trading agents with wallet or transaction authority. Covers prompt injection, spend limits, pre-send simulation, circuit breakers, MEV protection, and key handling. Us |
| `ecc:perl-security` | Comprehensive Perl security covering taint mode, input validation, safe process execution, DBI parameterized queries, web security (XSS/SQLi/CSRF), and perlcritic security policies. Use when reviewing |
| `ecc:production-audit` | Local-evidence production readiness audit for shipped apps, pre-launch reviews, post-merge checks, and "what breaks in prod?" questions without sending repo data to an external audit service. Use when |
| `ecc:quarkus-security` | Quarkus security implementation patterns: JWT and OIDC authentication, @RolesAllowed RBAC and SecurityIdentity checks, Bean Validation and custom validators, parameterized Panache queries, BCrypt pass |
| `ecc:security-bounty-hunter` | Hunt for exploitable, bounty-worthy security issues in repositories. Focuses on remotely reachable vulnerabilities that qualify for real reports instead of noisy local-only findings. Use when hunting  |
| `ecc:security-review` | Use this skill when adding authentication, handling user input, working with secrets, creating API endpoints, or implementing payment/sensitive features. Provides comprehensive security checklist and  |
| `ecc:security-scan` | Scan your Claude Code configuration (.claude/ directory) for security vulnerabilities, misconfigurations, and injection risks using AgentShield. Checks CLAUDE.md, settings.json, MCP servers, hooks, an |
| `ecc:springboot-security` | Spring Security best practices for authn/authz, validation, CSRF, secrets, headers, rate limiting, and dependency security in Java Spring Boot services. Use when reviewing Spring Security authn/authz, |
| `ecc:workspace-surface-audit` | Audit the active repo, MCP servers, plugins, connectors, env surfaces, and harness setup, then recommend the highest-value ECC-native skills, hooks, agents, and operator workflows. Use when the user w |


### AI & agent tooling

| Skill | Use case |
|---|---|
| `ecc:agent-architecture-audit` | Full-stack diagnostic for agent and LLM applications. Audits the 12-layer agent stack for wrapper regression, memory pollution, tool discipline failures, hidden repair loops, and rendering corruption. |
| `ecc:agent-eval` | Head-to-head comparison of coding agents (Claude Code, Aider, Codex, etc.) on custom tasks with pass rate, cost, time, and consistency metrics. Use when choosing between coding agents, or when a chang |
| `ecc:agent-harness-construction` | Design and optimize AI agent action spaces, tool definitions, and observation formatting for higher completion rates. Use when defining or revising an agent's tool set, action space, or observation fo |
| `ecc:agent-introspection-debugging` | Structured self-debugging workflow for AI agent failures using capture, diagnosis, contained recovery, and introspection reports. Use when an agent run fails and you need a reproducible diagnosis inst |
| `ecc:agent-payment-x402` | Add x402 payment execution to AI agents with per-task budgets, spending controls, and non-custodial wallets. Supports Base through agentwallet-sdk and X Layer through OKX Payments / OKX Agent Payments |
| `ecc:agent-self-evaluation` | Use after completing any non-trivial task. The agent self-rates its output on 5 axes — accuracy, completeness, clarity, actionability, conciseness — with concrete evidence per criterion. Produces a st |
| `ecc:agent-sort` | Build an evidence-backed ECC install plan for a specific repo by sorting skills, commands, rules, hooks, and extras into DAILY vs LIBRARY buckets using parallel repo-aware review passes. Use when ECC  |
| `ecc:agentic-engineering` | Operate as an agentic engineer using eval-first execution, decomposition, and cost-aware model routing. Use when planning or executing engineering work that agents will carry out end to end. |
| `ecc:agentic-os` | Build persistent multi-agent operating systems on Claude Code. Covers kernel architecture, specialist agents, slash commands, file-based memory, scheduled automation, and state management without exte |
| `ecc:ai-first-engineering` | Engineering operating model for teams where AI agents generate a large share of implementation output. Use when setting team process, review gates, or ownership rules for a codebase largely written by |
| `ecc:ai-regression-testing` | Regression testing strategies for AI-assisted development. Sandbox-mode API testing without database dependencies, automated bug-check workflows, and patterns to catch AI blind spots where the same mo |
| `ecc:autonomous-agent-harness` | Transform Claude Code into a fully autonomous agent system with persistent memory, scheduled operations, computer use, and task queuing. Replaces standalone agent frameworks (Hermes, AutoGPT) by lever |
| `ecc:continuous-agent-loop` | Patterns for continuous autonomous agent loops with quality gates, evals, and recovery controls. Use when running an agent loop that must self-check, gate on evals, and recover from failures. |
| `ecc:cost-aware-llm-pipeline` | Cost optimization patterns for LLM API usage — model routing by task complexity, budget tracking, retry logic, and prompt caching. Use when LLM spend needs to come down, or when routing tasks across m |
| `ecc:data-scraper-agent` | Build a fully automated AI-powered data collection agent for any public source — job boards, prices, news, GitHub, sports, anything. Runs on a schedule, enriches data with a free LLM (Gemini Flash), s |
| `ecc:enrichment-agent` | Pulls detailed profile, company, and activity data for qualified leads. Enriches prospects with recent news, funding data, content interests, and mutual overlap. |
| `ecc:enterprise-agent-ops` | Operational controls for long-lived or cloud-hosted agent systems — runtime lifecycle (start, pause, stop, restart), observability (logs, metrics, traces), least-privilege safety scopes and kill switc |
| `ecc:fal-ai-media` | Unified media generation via fal.ai MCP — image, video, and audio. Covers text-to-image (Nano Banana), text/image-to-video (Seedance, Kling, Veo 3), text-to-speech (CSM-1B), and video-to-audio (ThinkS |
| `ecc:gan-style-harness` | GAN-inspired Generator-Evaluator agent harness for building high-quality applications autonomously. Based on Anthropic's March 2026 harness design paper. Use when a feature should be built autonomousl |
| `ecc:html-template` |  |
| `ecc:llm-trading-agent-security` | Security patterns for autonomous trading agents with wallet or transaction authority. Covers prompt injection, spend limits, pre-send simulation, circuit breakers, MEV protection, and key handling. Us |
| `ecc:ml-adoption-playbook` | End-to-end methodology for AI agents and software engineers to add machine learning algorithms to existing non-ML codebases. Covers problem framing, data readiness, architectural decoupling, and basel |
| `ecc:regex-vs-llm-structured-text` | Decision framework for parsing structured text (quizzes, forms, invoices, receipts, tables) with a hybrid regex-first pipeline — regex extraction handles 95%+ cheaply, a confidence scorer flags low-co |
| `ecc:team-agent-orchestration` | Run team-based orchestration for agent squads: work items with owners and scope, agent Kanban state, branch isolation, control pane visibility, and merge gates. Use when coordinating multiple agents i |


### Documentation & specs

| Skill | Use case |
|---|---|
| `ecc:agent-introspection-debugging` | Structured self-debugging workflow for AI agent failures using capture, diagnosis, contained recovery, and introspection reports. Use when an agent run fails and you need a reproducible diagnosis inst |
| `ecc:blender-motion-state-inspection` | Use this skill when inspecting Blender characters, rigs, poses, animation retargeting, ground contact, facing direction, or model-vs-motion alignment where screenshots alone are not enough. |
| `ecc:docker-patterns` | Docker and Docker Compose patterns for local development, hardened CLI installer harnesses, container security, networking, volumes, and multi-service orchestration. Use when creating or reviewing Doc |
| `ecc:documentation-lookup` | Use up-to-date library and framework docs via Context7 MCP instead of training data. Activates for setup questions, API references, code examples, or when the user names a framework (e.g. React, Next. |
| `ecc:inventory-demand-planning` | Codified demand planning expertise for multi-location retailers: demand forecasting method selection, ABC/XYZ segmentation, safety stock and reorder-point optimization, promotional lift and post-promo |
| `ecc:knowledge-ops` | Knowledge base management, ingestion, sync, and retrieval across multiple storage layers (local files, MCP memory, vector stores, Git repos). Use when the user wants to save, organize, sync, deduplica |
| `ecc:living-docs-governance` | Keep a long-lived project's documentation from rotting by assigning existing project docs clear constitution, map, status, and history roles, then wiring the active agent harness to those canonical so |
| `ecc:nasiko-control-plane` | Manage the experimental Nasiko CLI lifecycle through ECC — read-only status checks, consent-gated install of the pinned qualified version with dry-run preview, and ownership-checked uninstall, under e |
| `ecc:nutrient-document-processing` | Process, convert, OCR, extract, redact, sign, and fill documents using the Nutrient DWS API. Works with PDFs, DOCX, XLSX, PPTX, HTML, and images. Use when converting, OCRing, extracting from, redactin |
| `ecc:plan-canvas` | Open plans and HTML artifacts in a local browser canvas where the human annotates elements, chats, and approves or requests changes without leaving the page. Use when presenting a plan for review, or  |
| `ecc:plan-orchestrate` | Read a plan document, decompose it into steps, design a per-step agent chain from the ECC catalogue, and emit ready-to-paste /orchestrate custom prompts. Generative only — never invokes /orchestrate i |
| `ecc:plankton-code-quality` | Write-time code quality enforcement using Plankton — auto-formatting, linting, and Claude-powered fixes on every file edit via hooks. Use when setting up write-time formatting, linting, or auto-fix ho |
| `ecc:spec_generator` |  |
| `ecc:visa-doc-translate` | Translate visa document images (bank deposit, employment, income, and retirement certificates; HEIC, PNG, or JPG) into English via OCR and produce a bilingual PDF pairing the original image with a for |


### Productivity & business

| Skill | Use case |
|---|---|
| `ecc:content-engine` | Create platform-native content systems for X, LinkedIn, TikTok, YouTube, newsletters, and repurposed multi-platform campaigns. Use when the user wants social posts, threads, scripts, content calendars |
| `ecc:content-hash-cache-pattern` | Cache expensive file processing results using SHA-256 content hashes — path-independent, auto-invalidating, with service layer separation. Use when repeated file processing is slow and results should  |
| `ecc:customer-billing-ops` | Operate customer billing workflows such as subscriptions, refunds, churn triage, billing-portal recovery, and plan analysis using connected billing tools like Stripe. Use when the user needs to help a |
| `ecc:data-handling` |  |
| `ecc:data-resolvers` |  |
| `ecc:data-scraper-agent` | Build a fully automated AI-powered data collection agent for any public source — job boards, prices, news, GitHub, sports, anything. Runs on a schedule, enriches data with a free LLM (Gemini Flash), s |
| `ecc:data-throughput-accelerator` | Diagnose and accelerate large data movement — ingestion, backfill, export, ETL, warehouse loading, manifest catch-up, and table synchronization — by isolating the true bottleneck, benchmarking variant |
| `ecc:finance-billing-ops` | Evidence-first revenue, pricing, refunds, team-billing, and billing-model truth workflow for ECC. Use when the user wants a sales snapshot, pricing comparison, duplicate-charge diagnosis, or code-back |
| `ecc:marketing-campaign` | End-to-end marketing campaign planning and execution. Covers audience research, positioning, campaign angle definition, landing page copy, email sequences, social posts, ad copy, short-form video scri |
| `ecc:seo` | Audit, plan, and implement SEO improvements across technical SEO, on-page optimization, structured data, Core Web Vitals, and content strategy. Use when the user wants better search visibility, SEO re |


## Cloud-Ops / Security skills

These skills live in the claude-skills-collection (cloud-ops and security are identical collections — deduplicated here).


### Categories

| Category | Count |
|---|---|
| [AI agent skills](#ai-agent-skills) | ~50 |
| [Cloud skills](#cloud-skills) | ~50 |
| [DevOps skills](#devops-skills) | ~40 |
| [Security skills](#security-skills) | ~20 |
| [Network skills](#network-skills) | ~15 |
| [Data & database](#data--database) | ~20 |
| [Linux & system](#linux--system) | ~20 |
| [API & automation](#api--automation) | ~20 |
| [Other](#other-cloudops-skills) | ~100 |


### AI agent skills

| Skill | Use case |
|---|---|
| `agent-observability` | Instrumentation technique d'un agent IA — tracing distribué des appels LLM et outils, spans, métriques custom, corrélation de logs et dashboards de supervision. Pour les alertes et garde-fous de production, voir agent-monitoring-setup. Se déclenche a |
| `api-caller-subagent` | Sous-agent spécialisé dans les appels API REST/GraphQL avec retry, auth et transformation de données. Se déclenche avec "sous-agent API", "API caller agent", "agent qui appelle une API", "REST agent", "HTTP agent", "API integration subagent", "extern |
| `browser-agent-builder` | Construction d'agents de navigation web autonomes incluant scraping intelligent, interaction DOM et gestion de sessions. Se déclenche avec "browser agent", "agent navigateur", "agent web autonome", "Puppeteer agent", "Playwright agent. Also triggers  |
| `code-review-subagent` | Sous-agent spécialisé dans la revue de code automatisée, déclenchable par un agent parent pour analyser du code, un diff ou une PR. Produit un rapport structuré avec findings classés par sévérité, corrections copiables et score qualité. Se déclenche  |
| `coding-agent-builder` | Construction d'agents de coding autonomes capables de lire, écrire et modifier du code. Se déclenche avec "coding agent", "agent de code", "agent développeur", "Devin", "SWE-agent", "agent qui code", "AI coder", "code generation agent", "auto-coder". |
| `crewai-expert` | Guide complet pour construire des systèmes multi-agents avec CrewAI. Création d'agents spécialisés, définition de tâches, orchestration de crews et intégration d'outils personnalisés. Se déclenche avec "CrewAI", "crew", "multi-agent CrewAI", "agent C |
| `customer-support-agent` | Construction d'agents de support client intelligents avec knowledge base, escalade et personnalisation. Se déclenche avec "agent support", "chatbot support", "customer support agent", "agent service client", "helpdesk agent", "FAQ bot", "support auto |
| `data-analyst-agent` | Création d'agents d'analyse de données qui explorent, visualisent et expliquent les données. Se déclenche avec "data analyst agent", "agent analyse données", "agent data", "agent qui analyse", "automated analysis", "data exploration agent", "agent SQ |
| `database-query-subagent` | Sous-agent spécialisé dans les requêtes base de données — SQL generation, exécution et analyse de résultats. Se déclenche avec "sous-agent DB", "database agent", "SQL agent", "agent base de données", "query agent", "agent qui requête", "text-to-SQL a |
| `email-agent-builder` | Construction d'agents de gestion d'emails incluant tri, réponse automatique, extraction et classification. Se déclenche avec "email agent", "agent email", "tri automatique", "réponse automatique email", "classification email. Also triggers on "auto r |
| `file-processor-subagent` | Sous-agent de traitement de fichiers — lecture, parsing, transformation et génération de fichiers multiformats. Se déclenche avec "sous-agent fichier", "file processing agent", "agent qui traite des fichiers", "PDF agent", "Excel agent", "document pr |
| `multi-agent-orchestrator` | Conception de systèmes multi-agents avec patterns d'orchestration (supervisor, swarm, hierarchy, voting). Coordination entre agents spécialisés, routing sémantique, gestion d'état distribué, error handling. Se déclenche avec "multi-agent", "orchestra |
| `openai-assistants-builder` | Création d'assistants IA hébergés avec l'API OpenAI Assistants v2. File search avec vector stores, code interpreter, function calling, threads persistants et streaming. Se déclenche avec "OpenAI Assistants", "assistant API", "file search", "code inte |
| `research-agent-designer` | Design d'agents de recherche autonomes pour collecter, analyser et synthétiser de l'information. Se déclenche avec "research agent", "agent de recherche", "agent web", "web research agent", "deep research", "agent qui cherche", "collecte d'informatio |
| `sales-agent-builder` | Construction d'agents de vente IA pour prospection, qualification et suivi commercial. Se déclenche avec "sales agent", "agent commercial", "agent de vente", "prospection IA", "SDR agent", "lead qualification agent", "outreach agent", "follow-up auto |
| `subagent-delegator` | Conception de systèmes de délégation parent-agent → sous-agents avec dispatch intelligent, suivi des tâches et agrégation des résultats. Se déclenche avec "sous-agent", "subagent", "délégation agent", "agent parent", "dispatch agent", "agent qui délè |
| `voice-agent-builder` | Construction d'agents vocaux conversationnels avec STT, TTS et gestion du dialogue. Se déclenche avec "voice agent", "agent vocal", "téléphone IA", "voice bot", "STT", "TTS", "speech to text", "conversational AI", "IVR intelligent", "Vapi", "LiveKit" |
| `web-scraper-subagent` | Construction d'un sous-agent spécialisé dans la collecte de données web pour un agent parent. Crawling, extraction, parsing et retour structuré. Se déclenche avec "sous-agent web", "scraper agent", "agent qui collecte", "web extraction agent", "crawl |
| `workflow-automation-agent` | Construction d'agents d'automatisation de workflows métier incluant RPA intelligent, déclencheurs et actions chaînées, orchestration d'étapes avec gestion d'erreurs et monitoring. Se déclenche avec "workflow agent", "RPA", "automatisation métier", "a |
| `ml-experiment-tracker` | Suivi et comparaison d'expériences d'entraînement ML — runs, hyperparamètres, métriques, artefacts et versioning dans un model registry. Couvre la phase d'entraînement et de comparaison, pas la mise en production (voir dev-ml-model-deployer). Se décl |
| `ai-agent-builder` | Conception et implémentation d'agents IA autonomes avec outils, mémoire et orchestration. Se déclenche avec "agent IA", "AI agent", "autonomous agent", "tool use", "function calling", "agent framework", "LangChain agent", "CrewAI", "AutoGen", "agent  |
| `ai-workflow-orchestrator` | Orchestration de workflows IA complexes avec chaînes et pipelines. Se déclenche avec "workflow IA", "LangChain", "LangGraph", "pipeline IA", "chaîne de prompts", "orchestration LLM", "AI pipeline", "multi-step AI". Also triggers on "chain LLM calls", |
| `llm-integration-guide` | Intégration de LLMs dans des applications via API. Se déclenche avec "API OpenAI", "Claude API", "intégrer un LLM", "GPT dans mon app", "Ollama", "LLM local", "streaming", "embeddings", "fine-tuning", "token management". Also triggers on "call an LLM |
| `ml-model-deployer` | Mise en production d'un modèle ML déjà entraîné (MLOps) — packaging, serving, endpoint d'inférence, scaling, détection de drift et rollback. Couvre le déploiement, pas le suivi d'entraînement (voir ai-ml-ml-experiment-tracker). Se déclenche avec "dép |
| `rag-pipeline-designer` | Conception de pipelines RAG (Retrieval-Augmented Generation) — architecture, chunking, embeddings, vector stores, retrieval hybride, re-ranking, évaluation RAGAS. Se déclenche avec "RAG", "retrieval augmented", "vector database", "embeddings", "knowl |

*1 more AI agent skills...*



### Cloud skills

| Skill | Use case |
|---|---|
| `aws-architect` | Architecture AWS couvrant EC2, Lambda, S3, RDS, VPC, IAM et CloudFormation. Se déclenche avec "AWS", "Amazon Web Services", "Lambda", "EC2", "S3", "CloudFormation", "architecture AWS. Also triggers on "AWS architecture", "design on AWS", "EC2 Lambda  |
| `azure-functions-expert` | Développement Azure Functions incluant triggers, bindings, Durable Functions, deployment et monitoring. Se déclenche avec "Azure Functions", "function Azure", "Durable Functions", "serverless Azure", "trigger Azure. Also triggers on "serverless on Az |
| `cloud-migration-planner` | Planification de migration vers le cloud incluant assessment, stratégie, lift-and-shift et refactoring. Se déclenche avec "migration cloud", "lift and shift", "cloud migration", "on-premise vers cloud", "migration strategy", "6 R's. Also triggers on  |
| `cloud-security-guide` | Sécurité cloud incluant IAM, encryption, networking, compliance, secrets management et CSPM. Se déclenche avec "sécurité cloud", "cloud security", "IAM", "encryption at rest", "CSPM", "compliance cloud. Also triggers on "IAM hardening", "secrets mana |
| `gcp-guide` | Services Google Cloud Platform incluant Cloud Run, BigQuery, GKE, Cloud Functions et Firestore. Se déclenche avec "GCP", "Google Cloud", "BigQuery", "Cloud Run", "GKE", "Firestore. Also triggers on "BigQuery setup", "GKE cluster". |
| `multi-cloud-strategist` | Stratégie multi-cloud et cloud hybride couvrant la portabilité, le vendor lock-in et le networking inter-cloud. Se déclenche avec "multi-cloud", "hybrid cloud", "vendor lock-in", "cloud agnostic", "cloud hybride. Also triggers on "multi-cloud strateg |
| `serverless-designer` | Conception d'architectures serverless couvrant Functions, event-driven, cold start et patterns avancés. Se déclenche avec "serverless", "functions as a service", "FaaS", "cold start", "event-driven serverless", "Azure Functions", "Lambda. Also trigge |
| `azure-devops-pipeline-advisor` | Conception de pipelines CI/CD avec Azure DevOps (YAML pipelines, stages, templates, déploiement multi-environnement). À utiliser quand l'utilisateur travaille avec Azure DevOps, configure des pipelines YAML ou gère des releases. Se déclenche aussi av |
| `cloud-cost-optimizer` | Optimise les coûts cloud (Azure, AWS, GCP) avec workflow FinOps structuré — audit, right-sizing, réservations, Spot, stockage, scheduling, monitoring. Se déclenche avec "coût cloud", "facture Azure", "AWS bill", "optimiser les coûts", "réduire la fac |
| `azure-cloud-advisor` | Conseils pour l'architecture et le déploiement sur Azure — App Service, Azure Functions, Container Apps, SQL Azure et bonnes pratiques cloud. À utiliser quand l'utilisateur déploie sur Azure, choisit des services cloud ou optimise ses coûts Azure. Se |


### DevOps skills

| Skill | Use case |
|---|---|
| `deployment-guide` | Déploiement d'agents IA en production avec scalabilité et fiabilité. Se déclenche avec "déployer agent", "agent en production", "agent API", "hosting agent", "agent scaling", "agent infrastructure", "servir un agent", "agent cloud". Also triggers on  |
| `pipeline-composer` | Composition de pipelines de sous-agents où la sortie d'un agent alimente l'entrée du suivant. Se déclenche avec "pipeline agent", "chaîne d'agents", "agent chain", "agent pipeline", "sequential agents", "workflow agents", "ETL agent", "agent DAG", "c |
| `nlp-pipeline-designer` | Conception de pipelines NLP (tokenization, embeddings, NER, sentiment, summarization) — guide opérationnel avec snippets, critères de décision et anti-patterns. Se déclenche avec : \"NLP\", \"traitement du langage\", \"NER\", \"sentiment analysis\",  |
| `cicd-pipeline-builder` | Conception de pipelines CI/CD pour tout type de plateforme. Se déclenche avec "CI/CD", "pipeline", "GitHub Actions", "Azure DevOps", "GitLab CI", "déploiement automatique", "continuous integration", "continuous deployment". Also triggers on "set up C |
| `data-pipeline-builder` | Conception de pipelines de données robustes et scalables. Se déclenche avec "data pipeline", "pipeline de données", "batch processing", "stream processing", "Apache Spark", "Airflow", "dbt", "data engineering". Also triggers on "build a data pipeline |
| `docker-composer` | Création et optimisation de Dockerfiles et docker-compose pour tout type de projet. Se déclenche avec "Docker", "Dockerfile", "docker-compose", "conteneur", "container", "image Docker", "multi-stage build", "optimiser mon image". Also triggers on "wr |
| `image-processing-pipeline` | Pipeline traitement d'image mobile (Kotlin ML Kit, OpenCV, CameraX). Crop, rotation, enhancement, compression, validation qualité, OCR, KYC. Se déclenche avec "traitement image", "image pipeline", "camera", "ML Kit", "OpenCV". Also triggers on "image |
| `kubernetes-helper` | Aide à la configuration et au déploiement sur Kubernetes. Se déclenche avec "Kubernetes", "K8s", "kubectl", "pod", "deployment", "service Kubernetes", "ingress", "helm", "cluster", "namespace". Also triggers on "Kubernetes manifest", "deploy to k8s", |
| `pencil-ui-designer` | Agent designer UI/UX autonome qui génère des interfaces complètes en fichiers HTML autonomes (Tailwind CSS + JS vanilla). À utiliser quand l'utilisateur veut créer, générer ou maquetter une interface, un écran, une app, un site web, un dashboard, une |
| `ansible-playbook-builder` | Automatisation d'infrastructure avec Ansible — playbooks, roles, inventaires, vault et modules. Se déclenche avec "Ansible", "playbook", "ansible-playbook", "Ansible role", "Ansible vault", "automatisation serveur". Also triggers on "Ansible playbook |
| `argocd-guide` | GitOps avec ArgoCD incluant applications, sync, rollbacks, multi-cluster et App of Apps pattern. Se déclenche avec "ArgoCD", "Argo CD", "GitOps", "sync ArgoCD", "application ArgoCD", "App of Apps. Also triggers on "ArgoCD application", "GitOps deploy |
| `docker-swarm-guide` | Orchestration avec Docker Swarm incluant services, stacks, overlay networks, secrets, rolling updates et haute disponibilité. Se déclenche avec "Docker Swarm", "swarm mode", "docker service", "docker stack", "overlay network. Also triggers on "Docker |
| `gitlab-ci-guide` | Pipelines GitLab CI/CD — stages, jobs, runners, artifacts, environments et Auto DevOps. Se déclenche avec "GitLab CI", "gitlab-ci.yml", "pipeline GitLab", "runner GitLab", "GitLab CD". Also triggers on "GitLab CI pipeline", ".gitlab-ci.yml", "GitLab  |
| `helm-chart-builder` | Conception de charts Helm pour Kubernetes — templates, values, dépendances et stratégies de déploiement. À utiliser quand l'utilisateur crée ou modifie des charts Helm, configure des déploiements K8s ou gère des releases. Se déclenche aussi avec "hel |
| `terraform-guide` | Guide Terraform — écriture de modules, state management, workspaces, providers et bonnes pratiques HCL. À utiliser quand l'utilisateur écrit ou débogue du Terraform précisément ; pour le choix d'outil IaC, voir dev-infrastructure-as-code. Se déclench |
| `decision-matrix` | Aide à prendre une décision complexe en structurant les options et critères. À utiliser quand l'utilisateur hésite entre plusieurs choix. Se déclenche aussi avec "je ne sais pas quoi choisir", "avantages inconvénients", "comparer les options", "matri |
| `incident-postmortem-guide` | Rédaction de post-mortems techniques après un incident — timeline, analyse des causes racines, actions correctives et leçons apprises. À utiliser quand l'utilisateur doit documenter un incident, analyser une panne ou structurer un retour d'expérience |
| `incident-response-plan` | Plan de réponse aux incidents de sécurité — préparation, détection, containment, éradication, recovery et lessons learned. Se déclenche avec "incident response", "plan de réponse", "breach", "compromission", "réponse à incident", "CSIRT". Also trigge |
| `ultra-concise-mode` | Force ultra-concise communication style — no filler, no pleasantries, tool-first, result-first, stop when done. Triggers on "concise mode", "short mode", "no filler", "talk short", "direct mode", "blunt mode". Also triggers on "be concise", "stop exp |
| `commercial-proposal-generic` | Génération d'offres commerciales professionnelles pour tout type de sujet ou secteur d'activité. Se déclenche avec "offre commerciale", "proposition commerciale", "offre de prestation", "devis", "pitch commercial", "offre de mission", "réponse à appe |

*5 more DevOps skills...*



### Security skills

| Skill | Use case |
|---|---|
| `security-hardener` | Sécurisation d'agents IA contre injections, abus et fuites de données. Se déclenche avec "sécurité agent", "agent security", "prompt injection", "jailbreak", "agent abuse", "guardrails", "safe agent", "sécuriser mon agent", "agent en production sécur |
| `owasp-checker` | Vérifie un projet contre le OWASP Top 10 (2021) et propose des remédiations concrètes avec exemples de code. À utiliser pour vérifier la conformité OWASP. Se déclenche avec "OWASP", "top 10", "failles web", "sécurité web", "A01 broken access", "injec |
| `secrets-scanner` | Détecte les secrets, clés API et credentials exposés dans le code source, l'historique Git et les fichiers de configuration. À utiliser pour vérifier qu'aucun secret n'est dans le code. Se déclenche avec "secrets", "clé API exposée", "credential leak |
| `security-auditor` | Audit de sécurité complet d'une application ou d'un code source — OWASP Top 10, analyse de dépendances, configuration serveur, cryptographie, secrets exposés. À utiliser quand l'utilisateur veut vérifier la sécurité de son projet. Se déclenche avec " |
| `smart-contract-auditor` | Audit de sécurité de smart contracts Solidity et blockchain. Se déclenche avec "smart contract", "Solidity", "audit blockchain", "vulnérabilité smart contract", "reentrancy", "ERC-20", "ERC-721", "Web3 security". Also triggers on "audit a smart contr |
| `vulnerability-analyzer` | Analyse et évalue les vulnérabilités d'un système ou d'une application. À utiliser pour comprendre et prioriser les vulnérabilités, construire un plan de remédiation et valider la correction. Se déclenche avec "vulnérabilité", "CVE", "faille", "vulne |
| `linux-security-hardener` | Durcissement sécurité Linux — SSH, fail2ban, SELinux, audit, gestion des utilisateurs et mises à jour. Se déclenche avec "sécurité Linux", "hardening Linux", "SSH sécurisé", "fail2ban", "SELinux", "audit Linux". Also triggers on "harden a Linux serve |
| `api-security-hardener` | Durcissement de la sécurité des APIs — rate limiting, validation d'entrée, headers de sécurité, CORS, protection contre les attaques courantes. À utiliser quand l'utilisateur sécurise une API, configure des headers de sécurité ou implémente du rate l |
| `dependency-audit` | Audit de sécurité des dépendances — détection de vulnérabilités connues, mises à jour critiques et gestion du cycle de vie des packages. À utiliser quand l'utilisateur veut vérifier la sécurité de ses dépendances, mettre à jour des packages vulnérabl |
| `security-audit-automation` | Automatisation d'audits de sécurité incluant scanning, reporting, intégration CI/CD et remediation tracking. Se déclenche avec "audit automatisé", "security scanning", "SAST", "DAST", "Trivy", "Snyk", "audit CI/CD. Also triggers on "automate security |
| `threat-modeling` | Modélisation des menaces pour applications et systèmes — identification des surfaces d'attaque, classification STRIDE, arbres d'attaque, scoring DREAD/CVSS et stratégies de mitigation priorisées. À utiliser quand l'utilisateur veut sécuriser une arch |
| `zero-trust-architect` | Architecture Zero Trust — never trust always verify, micro-segmentation réseau, approche identity-centric et accès conditionnel. Se déclenche avec "Zero Trust", "zero trust architecture", "never trust", "micro-segmentation", "BeyondCorp". Couvre l'év |


### Network skills

| Skill | Use case |
|---|---|
| `firewall-configurator` | Configuration de firewalls et règles de sécurité réseau pour iptables/nftables, pfSense, Azure NSG, AWS Security Groups et Cisco ACL. Se déclenche avec "firewall", "iptables", "pfSense", "NSG", "Security Group", "règles firewall", "ports. Also trigge |
| `vpn-architect` | Conception et déploiement de VPN incluant WireGuard, OpenVPN, IPSec pour les architectures site-to-site et remote access. Se déclenche avec "VPN", "WireGuard", "OpenVPN", "IPSec", "tunnel VPN", "site-to-site. Also triggers on "set up a VPN", "WireGua |


### Data & database

| Skill | Use case |
|---|---|
| `database-design-advisor` | Conception et modélisation de schémas de bases de données. Se déclenche avec "schéma base de données", "normalisation", "3NF", "database design", "modélisation relationnelle", "ERD. Also triggers on "design a database schema", "normalize my tables",  |
| `dynamodb-guide` | Modélisation et requêtes DynamoDB incluant single-table design, GSI, LSI, capacity modes et streams. Se déclenche avec "DynamoDB", "NoSQL AWS", "single-table design", "GSI", "partition key. Also triggers on "DynamoDB single-table design", "GSI design |
| `mongodb-guide` | Modélisation et requêtes MongoDB. Se déclenche avec "MongoDB", "Mongo", "NoSQL", "aggregation pipeline", "sharding", "replica set. Also triggers on "MongoDB schema", "document model". |
| `mysql-tuner` | Optimisation MySQL/MariaDB incluant slow query log, stratégie d'index, tuning InnoDB, réplication et monitoring. Se déclenche avec "MySQL", "MariaDB", "slow query", "InnoDB", "MySQL tuning", "requête MySQL lente. Also triggers on "MySQL slow query",  |
| `postgres-expert` | Administration et optimisation PostgreSQL — diagnostic de performance, indexation, partitioning, tuning mémoire, VACUUM, backup/restore, JSONB, réplication. Se déclenche avec "PostgreSQL", "Postgres", "pg_stat", "JSONB", "partitioning", "VACUUM", "pg |
| `redis-patterns` | Patterns d'utilisation Redis pour le cache, pub/sub, streams et sessions. Se déclenche avec "Redis", "cache distribué", "pub/sub Redis", "Redis streams", "session store. Also triggers on "Redis cache", "Redis pub/sub". |
| `sql-server-tuner` | Optimisation et administration SQL Server. Se déclenche avec "SQL Server", "SSMS", "execution plan", "index SQL Server", "Always On", "tempdb. Also triggers on "SQL Server performance", "T-SQL tuning", "execution plan analysis". |
| `dbt-guide` | Transformation de données avec dbt — models, tests, sources, macros et documentation automatisée. Se déclenche avec "dbt", "data build tool", "dbt model", "dbt test", "transformation de données dbt". Also triggers on "dbt models", "dbt tests", "trans |
| `sql-advanced-analytics` | Requêtes SQL avancées pour l'analytique — window functions, CTEs récursives, pivots et optimisation de requêtes complexes. À utiliser quand l'utilisateur écrit des requêtes analytiques, utilise des fonctions de fenêtrage ou optimise des requêtes SQL  |
| `database-migration-helper` | Gestion des migrations de bases de données et changements de schéma avec stratégies zero-downtime, rollback et data migration. Se déclenche avec "migration", "database migration", "changer le schéma", "EF migrations", "Flyway", "Liquibase", "ALTER TA |
| `database-query-optimizer` | Analyse et optimise des requêtes SQL ou NoSQL pour améliorer les performances. À utiliser quand l'utilisateur a une requête lente ou veut optimiser sa base de données. Se déclenche aussi avec "requête lente", "optimiser SQL", "EXPLAIN", "index", "per |
| `sqlite-guide` | Guide pour écrire des requêtes SQL et concevoir des schémas SQLite avec les bonnes pratiques. À utiliser quand l'utilisateur travaille avec SQLite, écrit des requêtes SQL ou conçoit des schémas de base de données. Se déclenche aussi avec "requête SQL |


### Linux & system

| Skill | Use case |
|---|---|
| `bash-scripting-expert` | Écriture de scripts Bash avancés — variables, boucles, fonctions, pipes, gestion d'erreurs et bonnes pratiques. Se déclenche avec "bash", "script bash", "shell script", "#!/bin/bash", "automatiser avec bash". Also triggers on "bash script", "shell sc |
| `linux-admin-guide` | Administration Linux complète — gestion des utilisateurs, permissions, services, logs, cron et packages. Se déclenche avec "Linux", "administration Linux", "chmod", "chown", "systemctl", "apt", "yum". Also triggers on "Linux administration", "manage  |
| `linux-troubleshooter` | Diagnostic de problèmes Linux — performance, disque, mémoire, réseau et processus. Se déclenche avec "Linux lent", "top", "htop", "df", "dmesg", "strace", "debug Linux". Also triggers on "Linux troubleshooting", "server is slow", "disk full", "high m |
| `systemd-manager` | Gestion de services avec systemd — units, timers, journalctl, boot et dépendances entre services. Se déclenche avec "systemd", "systemctl", "service Linux", "journalctl", "unit file", "timer systemd". Also triggers on "systemd unit", "systemd timer", |


### API & automation

| Skill | Use case |
|---|---|
| `n8n-workflow-designer` | Workflows d'automatisation avec n8n — nodes, triggers, credentials, déploiement self-hosted, intégrations SaaS et bonnes pratiques de fiabilité. Se déclenche avec "n8n", "workflow n8n", "automatisation open-source", "n8n self-hosted". Also triggers o |
| `zapier-workflow-builder` | Automatisation avec Zapier — Zaps multi-étapes, filtres, paths, webhooks et intégration entre applications. Se déclenche avec "Zapier", "Zap", "automatiser sans code", "connecter des apps", "webhook Zapier". Also triggers on "Zapier zap", "connect tw |
| `api-doc-generator` | Génère une documentation d'API claire et structurée à partir de code, routes ou descriptions. À utiliser quand l'utilisateur veut documenter une API REST, GraphQL ou des endpoints. Se déclenche aussi avec "documente mon API", "swagger", "endpoint doc |
| `fastapi-guide` | Développement d'APIs performantes avec FastAPI, Pydantic, async/await, OpenAPI et système de dépendances. Se déclenche avec "FastAPI", "Pydantic", "API Python", "async Python API", "uvicorn". Also triggers on "FastAPI app", "Pydantic models". |
| `graphql-builder` | Conception et implémentation de schémas et résolveurs GraphQL. Se déclenche avec "GraphQL", "schema", "query", "mutation", "subscription", "resolver", "Apollo", "Hot Chocolate". Also triggers on "GraphQL schema", "resolvers", "N+1 in GraphQL". |
| `integration-test-builder` | Crée des tests d'intégration pour vérifier l'interaction entre composants. Se déclenche avec "test d'intégration", "integration test", "tester l'API", "tester la DB", "test end-to-end", "test E2E", "Testcontainers", "WebApplicationFactory". Also trig |
| `openapi-contract-first` | Design d'API Contract-First avec OpenAPI/Swagger, génération de code, validation de contrats et documentation interactive. À utiliser quand l'utilisateur conçoit une API REST, écrit une spécification OpenAPI ou génère du code depuis un contrat. Se dé |
| `rest-api-designer` | Conception d'APIs REST conformes aux standards et bonnes pratiques. Se déclenche avec "API REST", "concevoir une API", "endpoints", "REST design", "resource naming", "HTTP methods", "API versioning", "pagination". Also triggers on "design a REST API" |
| `kong-api-gateway` | Configuration de Kong API Gateway — services, routes, plugins, rate limiting, authentification et monitoring. À utiliser quand l'utilisateur configure Kong, gère des APIs avec Kong ou implémente des plugins. Se déclenche aussi avec "Kong", "Kong Gate |


### Other Cloud-Ops/Security skills

| Skill | Use case |
|---|---|
| `a2a-protocol-guide` | Guide du protocole Agent-to-Agent (A2A) de Google pour l'interopérabilité entre agents IA — découverte, communication et collaboration inter-agents, avec exemples de code, critères de décision et pièges à éviter. Se déclenche avec "A2A", "agent-to-ag |
| `autogen-guide` | Développement d'agents conversationnels avec Microsoft AutoGen. Création de group chats, agents spécialisés et workflows multi-agents avec exécution de code. Se déclenche avec "AutoGen", "Microsoft AutoGen", "autogen agent", "group chat agent", "Conv |
| `claude-code-extension-builder` | Construction d'extensions et skills pour Claude Code — slash commands, hooks, intégration MCP et commandes personnalisées. Se déclenche avec "extension Claude Code", "skill Claude", "slash command", "Claude Code plugin", "custom command Claude". Also |
| `conflict-resolver` | Résolution de conflits entre agents ou sous-agents quand les résultats sont contradictoires, avec workflow de détection, arbitrage, merge et feedback loop. Se déclenche avec "conflit agent", "agent conflict", "résultats contradictoires", "agent disag |
| `consensus-builder` | Mécanismes de consensus et de vote entre agents pour prendre des décisions collectives fiables. Se déclenche avec "consensus agent", "vote agents", "décision collective", "agent voting", "multi-agent decision", "majority vote", "agent debate", "agent |
| `context-manager` | Gestion avancée du contexte pour agents IA — fenêtre de contexte, compression, RAG dynamique, sliding window, prompt caching. Se déclenche avec "context window", "contexte agent", "token limit", "context management", "context overflow", "trop de cont |
| `cost-optimizer` | Optimisation des coûts des agents IA — tokens, API calls, modèles, caching, routing, budget controls. Se déclenche avec "coût agent", "agent cher", "réduire les coûts IA", "token optimization", "optimiser les tokens", "budget agent", "agent cost", "é |
| `evaluation-framework` | Framework d'évaluation et benchmarking d'agents IA. Métriques, tests, comparaisons et quality assurance. Se déclenche avec "évaluer agent", "agent eval", "benchmark agent", "tester mon agent", "qualité agent", "agent metrics", "agent performance", "L |
| `handoff-designer` | Design de handoffs fluides entre agents — transfert de contexte, d'état et de responsabilité. Se déclenche avec "handoff", "transfert agent", "agent handoff", "passer la main", "relay agent", "agent transition", "changement d'agent", "routing entre a |
| `hierarchy-designer` | Design de hiérarchies d'agents multi-niveaux (orchestrateur → managers → workers → sous-agents spécialisés). Se déclenche avec "hiérarchie agent", "agent hierarchy", "manager agent", "worker agent", "arbre d'agents", "organisation agents", "agent tre |
| `human-in-the-loop-designer` | Design de systèmes human-in-the-loop pour agents IA avec approbation, correction et escalade. Se déclenche avec "human in the loop", "HITL", "approbation humaine", "validation humaine", "escalade agent", "agent supervisé", "intervention humaine", "ap |
| `langgraph-designer` | Conception de graphes d'agents avec LangGraph pour workflows complexes et stateful. Gestion d'état partagé, edges conditionnels, persistance et human-in-the-loop. Se déclenche avec "LangGraph", "graph agent", "state machine agent", "agent graph", "co |
| `load-balancer` | Distribution de charge entre sous-agents avec routing intelligent et optimization des ressources. Se déclenche avec "load balancer agent", "distribution charge", "agent load balancing", "répartir tâches", "agent routing", "balance agents", "parallel  |
| `marketplace-creator` | Création de marketplaces et registres d'agents IA réutilisables et partageables. Se déclenche avec "marketplace agent", "agent store", "agent registry", "partager agent", "distribuer agent", "agent template", "agent catalog", "agent as a service", "s |
| `mcp-server-builder` | Création de serveurs MCP (Model Context Protocol) pour exposer des outils, ressources et prompts aux LLMs. Se déclenche avec "MCP", "Model Context Protocol", "MCP server", "MCP tool", "MCP resource", "serveur MCP", "connecter Claude à", "exposer une  |
| `memory-designer` | Architecture de mémoire pour agents IA — short-term, long-term, episodic, semantic, working memory. Se déclenche avec "mémoire agent", "agent memory", "long-term memory", "context window", "vector memory", "conversation history", "agent qui se souvie |
| `message-protocol` | Design de protocoles de communication entre agents et sous-agents — formats de messages, routing, delivery guarantees, ACK/NACK, versioning et middleware. Se déclenche avec "protocole agent", "message protocol", "communication agent", "agent messagin |
| `monitoring-setup` | Mise en place opérationnelle de la surveillance d'un agent IA en production — alertes coût et qualité, garde-fous, budgets de tokens, détection de boucles et d'échecs d'outils, astreinte. Pour l'instrumentation technique (tracing, métriques), voir ag |
| `pool-manager` | Gestion de pools de sous-agents pré-instanciés pour performance et réutilisation. Se déclenche avec "pool agent", "agent pool", "pool de sous-agents", "pre-allocated agents", "agent reuse", "warm agents", "agent cache", "worker pool agents". Couvre s |
| `prompt-tuner` | Optimisation systématique des prompts d'agents pour améliorer performance et fiabilité. Se déclenche avec "optimiser prompt agent", "agent prompt", "améliorer mon agent", "prompt tuning", "agent accuracy", "agent qui se trompe", "calibrer agent", "af |
| `result-aggregator` | Agrégation et synthèse des résultats de multiples sous-agents en un résultat cohérent. Se déclenche avec "agréger résultats", "fusionner résultats", "combiner outputs", "agent aggregator", "merge results", "synthèse multi-agent", "consolider résultat |
| `retry-strategist` | Stratégies de retry intelligentes pour sous-agents qui échouent — backoff, fallback, alternatives et recovery. Se déclenche avec "retry agent", "agent qui échoue", "agent retry", "fallback agent", "error recovery agent", "agent resilience", "agent fa |
| `semantic-kernel-guide` | Développement d'agents IA avec Microsoft Semantic Kernel en .NET/C# et Python. Plugins natifs, plugins prompts, planners, filters, AgentGroupChat et intégration enterprise Azure. Se déclenche avec "Semantic Kernel", "SK", "Microsoft Semantic Kernel", |
| `skill-creator` | Agent spécialisé dans la création de nouveaux skills pour Claude Code. Génère des SKILL.md complets et structurés à partir d'une description de besoin. Se déclenche avec "créer un skill", "nouveau skill", "skill creator", "générer un skill", "fabriqu |
| `skill-router` | Agent orchestrateur central qui analyse chaque demande utilisateur et ACTIVE automatiquement le skill ou l'agent le plus adapte. Se declenche AUTOMATIQUEMENT sur toute demande ambigue, multi-domaine ou quand l'utilisateur ne sait pas quel skill utili |
| `spawner` | Création dynamique de sous-agents à la volée avec configuration, lifecycle management et resource allocation. Se déclenche avec "spawner", "créer agent dynamiquement", "spawn agent", "agent factory", "agent dynamique", "instancier agent", "agent à la |
| `state-synchronizer` | Synchronisation d'état entre agents et sous-agents travaillant en parallèle sur un état partagé. Se déclenche avec "synchronisation agent", "état partagé", "shared state", "agent sync", "concurrent agents", "state management multi-agent", "parallel a |
| `supervisor-builder` | Construction d'agents superviseurs qui contrôlent, monitent et corrigent des sous-agents en temps réel. Se déclenche avec "supervisor agent", "agent superviseur", "contrôler sous-agents", "manager agent", "agent oversight", "superviser agents", "agen |
| `task-decomposer` | Décomposition automatique de tâches complexes en sous-tâches pour distribution aux sous-agents. Se déclenche avec "décomposer tâche", "task decomposition", "découper en sous-tâches", "diviser le travail", "plan d'exécution agent", "agent planner", "w |
| `testing-framework` | Framework de test complet pour agents IA — tests unitaires, d'intégration, de bout en bout et adversariaux. Se déclenche avec "tester agent", "agent testing", "test agent IA", "agent CI/CD", "agent regression", "quality assurance agent", "agent test  |

*179 more skills in business, productivity, dev, design, etc...*



## Hyperframes skills

Video, animation, motion graphics, and visual storytelling skills for Remotion/Figma/GSAP workflows.


| Skill | Use case |
|---|---|
| `build-spec` |  |
| `captions-overlay` | Overlay doctrine for the embedded-captions workflow — the caption MODEL (drop / rail / embed) and the rule that captions are an OVERLAY composited on top of the film, never a reserved bottom band you shift content up to avoid. Load when adding captio |
| `changelog-video` | Turn a weekly changelog .md into a finished branded changelog video (square 1080, ~45-60s, Annie VO, animated brand background, mock-UI visualizations, lowkey captions). Use when the user provides a changelog/digest markdown and wants the weekly vide |
| `cut-the-curve` | The technique catalog: five velocity-matched SEAMS (zoom-through, INVERSE zoom-through, cut-the-curve, waterfall cut, rack-focus blur-cut) plus the two in-scene techniques — waterfall ENTRY (staggered arrival cascades for title cards / segment opener |
| `gsap-implementation` |  |
| `motion-doctrine` | GATEWAY — load FIRST before composing any HyperFrames animation or video. The high-level motion law that makes a multi-scene video feel like ONE continuous camera move instead of a stack of independently-animated slides. Covers the vector law (how yo |
| `oversized-cursor` | House-style oversized macOS cursor technique for HyperFrames launch videos. Load whenever a scene involves cursors or a pointer-led action, when kicking off a UI scene, when igniting a morph/transition/typing run with a click, or when a scene reads a |
| `script-voice` |  |
| `seam-craft` | Render-correctness doctrine for scene-to-scene seams in HyperFrames launch videos — the prerequisites that make transitions composite correctly on the master timeline. Load when assembling the master timeline / index.html, when a white flash appears  |
| `seam-gate` |  |
| `visualization-registry` |  |
| `3d-camera-flight` | Perspective camera FLIGHT through a 3D-laid-out world — one static perspective stage + preserve-3d world whose pose (translate3d + rotateX/rotateY) is tweened leg-by-leg from a single camera state object. Dive into an angled grid, tilt-to-flatten pul |
| `CATALOG` |  |
| `TRANSITION-REGISTRY` |  |
| `camera-cursor-tracking` | Two-phase virtual camera that locks viewport to a moving focal point with configurable initial positioning. |
| `camera-journey` |  |
| `caption-template-motion` | The named flow + climax entrance/exit recipes (GSAP, seek-safe) that the per-template files reference, plus the motion numerics (ease palette, exit=75% entry, climax dwell, restraint, mood→motion). Every template picks a FLOW_IN/OUT and a CLIMAX_IN/O |
| `catalog` |  |
| `catalog-map` |  |
| `context-sensitive-cursor` | Cursor color and styling that adapt to the current text segment being typed — accent color on highlights, dim on placeholders, etc. |

*32 more core Hyperframes skills...*


### Frame & technique catalogs

| Skill | Use case |
|---|---|
| `3d-page-scroll` | Full webpage rendered as tilted 3D card that scrolls to reveal specific sections. |
| `3d-text-depth-layers` | Multiple offset text layers create a stacked 3D shadow / extrusion effect on large typography — more impactful than CSS text-shadow because each layer |
| `Biennale Yellow — Frame (video / frame layer)` | > |
| `BlockFrame — Frame (video / frame layer)` | > |
| `Blue Professional — Frame (video / frame layer)` | > |
| `Bold Poster — Frame (video / frame layer)` | > |
| `Broadside — Frame (video / frame layer)` | > |
| `CREDITS` | (see catalog) |
| `Capsule — Frame (video / frame layer)` | > |
| `Cartesian — Frame (video / frame layer)` | > |
| `Cobalt Grid — Frame (video / frame layer)` | > |
| `Code editorial — Frame (video / frame layer)` | > |
| `Coral — Frame (video / frame layer)` | > |
| `Creative Mode — Frame (video / frame layer)` | > |
| `DESIGN_INDEX` | (see catalog) |
| `Daisy Days — Frame (video / frame layer)` | > |
| `Editorial Forest — Frame (video / frame layer)` | > |
| `NOTICE` | (see catalog) |
| `PROTOCOL` | (see catalog) |
| `USAGE` | (see catalog) |
| `add-block` | (see catalog) |
| `add-component` | (see catalog) |
| `aesthetic-principles` | (see catalog) |
| `agent-progress-theater` | (see catalog) |
| `ai-tracking-box` | Animated bounding box with L-shaped corner markers following an oscillating path — simulates AI object detection / tracking. |
| `ambient-glow-bloom` | Un-triggered soft radial glow that blooms in behind a hero element and holds with a bounded idle breathe, or a single-pass traveling sweep across a su |
| `anchored-layout-expand` | Edge-pinned container grows (or collapses) along ONE axis and in-flow content reflows with it — a pill springs open downward into a dropdown, a panel  |
| `animate-text` | (see catalog) |
| `anti-patterns` | (see catalog) |
| `api-map` | (see catalog) |

*223 more frame/technique catalog entries...*



## Context-mode tools

Local indexed search and sandbox computation tools. Most are invoked via MCP.


| Tool | Use case |
|---|---|
| `0001-sessiondb-multi-writer` |  |
| `0002-tool-description-style` |  |
| `0003-routing-deny-reasons` |  |
| `0004-stats-strict-compression-formula` |  |
| `AGENTS` |  |
| `BENCHMARK` |  |
| `CLAUDE` |  |
| `CONTRIBUTING` |  |
| `GEMINI` |  |
| `KIRO` |  |
| `PULL_REQUEST_TEMPLATE` |  |
| `QWEN` |  |
| `SYSTEM` |  |
| `UPSTREAM-CREDITS` |  |
| `agent-teams` |  |
| `anti-patterns` |  |
| `communication` |  |
| `context-mode` | | |
| `context-mode-ops` | Manage context-mode GitHub issues, PRs, releases, and marketing with parallel subagent army. Orchestrates 10-20 dynamic agents per task. Use when triaging issues, reviewing PRs, releasing versions, wr |
| `context7-nextjs-docs` |  |
| `context7-react-docs` |  |
| `context7-supabase-edge` |  |
| `context7-tailwind-docs` |  |
| `copilot-instructions` |  |
| `mcp__plugin_context-mode_context-mode__ctx-doctor` | | |
| `mcp__plugin_context-mode_context-mode__ctx-index` | | |
| `mcp__plugin_context-mode_context-mode__ctx-insight` | | |
| `mcp__plugin_context-mode_context-mode__ctx-purge` | | |
| `mcp__plugin_context-mode_context-mode__ctx-search` | | |
| `mcp__plugin_context-mode_context-mode__ctx-stats` | | |
| `mcp__plugin_context-mode_context-mode__ctx-upgrade` | | |
| `jetbrains-copilot` |  |
| `kimi-code` |  |
| `marketing` |  |
| `openclaw` |  |
| `patterns-javascript` |  |
| `patterns-python` |  |
| `patterns-shell` |  |
| `platform-support` |  |
| `release` |  |
| `review-pr` |  |
| `tdd` |  |
| `triage-issue` |  |
| `validation` |  |


## UI/UX Pro Max

| Skill | Use case |
|---|---|
| `pro-rules` |  |
| `quick-reference` |  |
| `ui-ux-pro-max` | UI/UX design intelligence for web, mobile, and desktop. This skill should be used when designing, building, reviewing, or fixing interfaces, including pages, components, design systems, accessibility, |


## Karpathy guidelines

| Skill | Use case |
|---|---|
| `CLAUDE` |  |
| `CURSOR` |  |
| `EXAMPLES` |  |
| `README.zh` |  |
| `karpathy-guidelines` | Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactoring code to avoid overcomplication, make surgical changes, surface assumptions, and define verifiable success criteria. |


## Trailofbits

Security audit, threat modeling, and code review patterns.


| Skill | Use case |
|---|---|
| `adversarial` |  |
| `adversarial-modeler` | Models attacker perspectives and builds exploit scenarios for HIGH RISK code changes. Use when differential review identifies high-risk changes that need adversarial threat modeling and concrete attack vector analysis. |
| `audit` |  |
| `auth-patterns` |  |
| `case-studies` |  |
| `config-patterns` |  |
| `crypto-apis` |  |
| `debug-features` |  |
| `default-credentials` |  |
| `dependabot` |  |
| `diff-review` |  |
| `differential-review` | Performs security-focused differential review of code changes. Adapts analysis depth to codebase size, uses git blame for context, calculates blast radius by counting callers, checks test coverage of modified code, and generates a markdown report. Us |
| `fail-open-security` |  |
| `fallback-secrets` |  |
| `lang-c` |  |
| `lang-csharp` |  |
| `lang-go` |  |
| `lang-java` |  |
| `lang-javascript` |  |
| `lang-kotlin` |  |
| `lang-php` |  |
| `lang-python` |  |
| `lang-ruby` |  |
| `lang-rust` |  |
| `lang-swift` |  |
| `language-specific` |  |
| `methodology` |  |
| `migration-checklist` |  |
| `modern-python` | Configures Python projects with modern tooling (uv, ruff, ty). Use when creating projects, writing standalone scripts, or migrating from pip/Poetry/mypy/black. |
| `patterns` |  |
| `pep723-scripts` |  |
| `permissive-access` |  |
| `prek` |  |
| `pyproject` |  |
| `reporting` |  |
| `ruff-config` |  |
| `security-setup` |  |
| `sharp-edges` | Identifies error-prone APIs, dangerous configurations, and footgun designs that enable security mistakes. Use when reviewing API designs, configuration schemas, cryptographic library ergonomics, or evaluating whether code follows 'secure by default'  |
| `sharp-edges-analyzer` | Evaluates APIs, configurations, and library interfaces for misuse resistance and footgun potential. Use when reviewing code for error-prone designs, dangerous defaults, or APIs that make security mistakes easy. |
| `supply-chain-risk-auditor` | Audits a project's dependencies for supply-chain risk: version-matched advisories for direct dependencies and the full lockfile tree, abandoned or archived upstreams, npm publisher concentration, and install-time script execution. Use when asked to a |
| `testing` |  |
| `uv-commands` |  |
| `weak-crypto` |  |


## Frontend design

| Skill | Use case |
|---|---|
| `frontend-design` | Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. Helps with aesthetic direction, typography, and making choices that don't read as templated defaults. |


## User-level skills

Located in `~/.claude/skills/`. These are Jack's personal helper skills.


| Skill | Use case |
|---|---|
| `.claude` |  |
| `.trash` |  |
| `abdul` | Use ABDUL, Jack's personal assistant on this PC, through its MCP tools (abdul_*) - his tasks, calendar, memory, shared lists, phone notifications, background research and ABDUL's own health. Use when a job touches Jack's schedule, to-dos, preferences |
| `agent-reach` | > |
| `bash-scripting` | Write and review Bash scripts that are safe to re-run on this PC - strict mode, quoting, traps, argument parsing, ShellCheck. Triggers on "bash script", "shell script", "set -euo pipefail", "shellcheck", "write a script that", "cron job script". |
| `changelog-generator` | Automatically creates user-facing changelogs from git commits by analyzing commit history, categorizing changes, and transforming technical commits into clear, customer-friendly release notes. Turns hours of manual changelog writing into minutes of a |
| `competitive-ads-extractor` | Extracts and analyzes competitors' ads from ad libraries (Facebook, LinkedIn, etc.) to understand what messaging, problems, and creative approaches are working. Helps inspire and improve your own ad campaigns. |
| `content-research-writer` | Assists in writing high-quality content by conducting research, adding citations, improving hooks, iterating on outlines, and providing real-time feedback on each section. Transforms your writing process from solo effort to collaborative partnership. |
| `demo-skill` | test skill |
| `domain-name-brainstormer` | Generates creative domain name ideas for your project and checks availability across multiple TLDs (.com, .io, .dev, .ai, etc.). Saves hours of brainstorming and manual checking. |
| `file-organizer` | Intelligently organizes your files and folders across your computer by understanding context, finding duplicates, suggesting better structures, and automating cleanup tasks. Reduces cognitive load and keeps your digital workspace tidy without manual |
| `github-task` | Manage GitHub Issues as tasks — list, move between columns, update with comments, and order the Plan tab. Reads GitHub config from .GitHubBoard/github-sync.json in the current project. Use when the user invokes /github-task or asks to "check tasks", |
| `graphify` | Use for any question about a codebase, its architecture, file relationships, or project content — especially when graphify-out/ exists, where the question should be treated as a graphify query first. Turns any input (code, docs, papers, images, video |
| `image-enhancer` | Improves the quality of images, especially screenshots, by enhancing resolution, sharpness, and clarity. Perfect for preparing images for presentations, documentation, or social media posts. |
| `invoice-organizer` | Automatically organizes invoices and receipts for tax preparation by reading messy files, extracting key information, renaming them consistently, and sorting them into logical folders. Turns hours of manual bookkeeping into minutes of automated organ |
| `langsmith-fetch` | Debug LangChain and LangGraph agents by fetching execution traces from LangSmith Studio. Use when debugging agent behavior, investigating errors, analyzing tool calls, checking memory operations, or examining agent performance. Automatically fetches |
| `lead-research-assistant` | Identifies high-quality leads for your product or service by analyzing your business, searching for target companies, and providing actionable contact strategies. Perfect for sales, business development, and marketing professionals. |
| `learned` |  |
| `meeting-insights-analyzer` | Analyzes meeting transcripts and recordings to uncover behavioral patterns, communication insights, and actionable feedback. Identifies when you avoid conflict, use filler words, dominate conversations, or miss opportunities to listen. Perfect for pr |
| `mint-admin` | Everyday administration of a Linux Mint PC - packages with apt and Flatpak, users and groups, permissions, cron and timers, logs, mounts, Timeshift. Triggers on "apt install", "PPA", "flatpak", "add user to group", "chmod", "chown", "fstab", "mount a |
| `mint-hardening` | Harden a Linux Mint desktop that also runs AI agents - firewall, SSH keys only, automatic security updates, fail2ban, AppArmor, keyring for secrets, an audit trail - without locking yourself out. Triggers on "harden", "firewall", "ufw", "ssh hardenin |
| `mint-troubleshooter` | Diagnose a slow or misbehaving Linux Mint desktop - CPU, memory, disk, GPU, network, a failed service - by taking a baseline first and changing one thing at a time. Triggers on "Mint is slow", "high memory", "disk full", "no space left", "dmesg", "wo |
| `pc-backup` | Back up and restore this PC - Timeshift for the system, a home-folder backup for files, what to exclude (model caches), and a restore test. Triggers on "backup", "timeshift", "restore", "snapshot before", "rsync my home", "what should I back up". |
| `pc-docker` | Docker and Compose stacks on this PC - status, logs, updating images, reclaiming disk, the docker group, GPU passthrough for a container. Triggers on "docker", "compose", "container is down", "docker logs", "prune", "docker disk", "nvidia container", |
| `pc-network` | Diagnose and fix networking on this PC - no internet, DNS, Wi-Fi drops, VPN, a port that should or should not be open, NetworkManager, the NeuraOS engine or web UI not reachable. Triggers on "no internet", "DNS", "wifi keeps dropping", "can't reach", |
| `pc-patch` | Update this Linux Mint PC safely - apt, Flatpak, firmware, kernels, the NeuraOS app and Claude Code - with a Timeshift snapshot first and a clear list of what changed. Triggers on "update the system", "apt upgrade", "patch", "install updates", "updat |
| `pc-security-audit` | A periodic security audit of this PC that runs agents - open ports, logins, sudo use, updates, firewall, AppArmor, the agent audit log, secrets on disk - as a report with a fix list, changing nothing. Triggers on "security audit", "am I exposed", "ch |
| `pc-triage` | Start here for any "something is wrong with this PC" request - decide in one pass which pc-ops skill applies, after a read-only look, before changing anything. Triggers on "my PC", "this machine", "something's wrong", "is everything ok", "health chec |
| `pc-vitals` | Read-only vitals of this PC in one screen - CPU, memory, disk, GPU and VRAM, temperatures, top processes, uptime, pending reboot - with nothing changed. Triggers on "vitals", "how is the PC doing", "show me the load", "temperatures", "GPU usage", "wh |
| `raffle-winner-picker` | Picks random winners from lists, spreadsheets, or Google Sheets for giveaways, raffles, and contests. Ensures fair, unbiased selection with transparency. |
| `synced` |  |
| `systemd-manager` | Create, edit, time and debug systemd units on Linux Mint, system-wide or per user. Triggers on "systemd", "service file", "systemctl --user", "timer instead of cron", "unit failed", "daemon-reload", "journalctl -u". |
| `tailored-resume-generator` | Analyzes job descriptions and generates tailored resumes that highlight relevant experience, skills, and achievements to maximize interview chances |
| `trading-research` | Use for trading, quant, backtesting, stock screening, market analysis or trading-agent R&D. Points to Jack's cloned reference library of trading skills (tradermonty, himself65, quantskills, LangAlpha, awesome-trading-agents) and says how to use it. |
| `twitter-algorithm-optimizer` | Analyze and optimize tweets for maximum reach using Twitter's open-source algorithm insights. Rewrite and edit user tweets to improve engagement and visibility based on how the recommendation system ranks content. |
| `youtube-downloader` | Download YouTube videos with customizable quality and format options. Use this skill when the user asks to download, save, or grab YouTube videos. Supports various quality settings (best, 1080p, 720p, 480p, 360p), multiple formats (mp4, webm, mkv), a |
| `webapp-testing` | Toolkit for interacting with and testing local web applications using Playwright. Supports verifying frontend functionality, debugging UI behavior, capturing browser screenshots, and viewing browser logs. |


## MCP servers (tools, invoked directly by name)


| Server | Tools prefix | What it's for |
|---|---|---|
| `context7` | `mcp__context7__*` | Live library/framework docs (React, Tailwind, Supabase, etc.). |
| `github` | `mcp__github__*` | Full GitHub: repos, PRs, issues, commits. |
| `lovable` | `mcp__lovable__*` | Drives a Lovable cloud project (new UI). |
| `supabase` | `mcp__supabase__*` | Reads/writes a Supabase project (schema, migrations, SQL). |
| `context-mode` | `mcp__plugin_context-mode_context-mode__*` | Local indexed search + sandbox computation over files. |
| `chrome-devtools` | `mcp__plugin_ecc_chrome-devtools__*` | Browser automation/testing via CDP. |
| `puppeteer` | `mcp__puppeteer__*` | Headless browser automation. |
| `playwright` | `mcp__playwright__*` | E2E testing. |
| `memory` | `mcp__memory__*` | Persistent file-based memory across conversations. |


## Built-in & harness tools


| Tool | What it's for |
|---|---|
| `Read` / `Write` / `Edit` | Read, create, edit files. |
| `Bash` | Run shell commands (sandboxed). |
| `Grep` / `Glob` | Search files by content/pattern. |
| `Agent` | Spawn a fresh worker agent (choose type from [Agent types table](#agent-types)). |
| `Skill` | Invoke a skill by name (e.g., `superpowers:brainstorming`). |
| `Workflow` | Run a multi-agent orchestration script. |
| `ReportFindings` | Report code-review findings as a typed list. |
| `AskUserQuestion` | Ask a blocking question when only the user can decide. |
| `ListAgents` | List in-process subagents and teammates. |
| `ToolSearch` | Load deferred tool schemas before calling them. |
| `ScheduleWakeup` | Schedule a /loop wakeup for autonomous polling. |
| `CronCreate` | Create a recurring cron task. |
| `DeferredToolPlaceholder` | Internal: keeps deferred tools active. |


## Agent types

Fresh-worker agent templates you can spawn via the `Agent` tool (`subagent_type` parameter).


| Agent type | When to use |
|---|---|
| `beam-free` | Implementation worker pinned to the beam-free model. Use for CCE plan tasks. |
| `claude` | Catch-all for any task that doesn't fit a more specific agent. Default. |
| `differential-review:adversarial-modeler` | Models attacker perspectives and builds exploit scenarios for HIGH RISK code changes. |
| `ecc:a11y-architect` | Accessibility Architect specializing in WCAG 2.2 compliance for Web and Native platforms. |
| `ecc:agent-evaluator` | Evaluates agent output against 5-axis quality rubric. |
| `ecc:architect` | Software architecture specialist for system design, scalability, and technical decisions. |
| `ecc:build-error-resolver` | Build and TypeScript error resolution specialist. Fixes build/type errors with minimal diffs. |
| `ecc:code-explorer` | Deeply analyzes existing codebase features by tracing execution paths, mapping architecture layers. |
| `ecc:code-reviewer` | Expert code review specialist for quality, security, and maintainability. |
| `ecc:code-simplifier` | Simplifies and refines code for clarity, consistency, and maintainability while preserving behavior. |
| `ecc:comment-analyzer` | Analyze code comments for accuracy, completeness, maintainability, and comment rot risk. |
| `ecc:conversation-analyzer` | Analyze conversation transcripts to find behaviors worth preventing with hooks. |
| `ecc:cpp-build-resolver` | C++ build, CMake, and compilation error resolution specialist. |
| `ecc:cpp-reviewer` | Expert C++ code reviewer specializing in memory safety, modern C++ idioms, concurrency. |
| `ecc:csharp-reviewer` | Expert C# code reviewer specializing in .NET conventions, async patterns, security. |
| `ecc:dart-build-resolver` | Dart/Flutter build, analysis, and dependency error resolution specialist. |
| `ecc:database-reviewer` | PostgreSQL database specialist for query optimization, schema design, security. |
| `ecc:django-build-resolver` | Django/Python build, migration, and dependency error resolution specialist. |
| `ecc:django-reviewer` | Expert Django code reviewer specializing in ORM correctness, DRF patterns, security. |
| `ecc:docs-lookup` | Fetch current documentation and code examples for libraries, frameworks, APIs. |
| `ecc:e2e-runner` | End-to-end testing specialist using Vercel Agent Browser with Playwright fallback. |
| `ecc:flutter-build-resolver` | Flutter build, analysis, and dependency error resolution specialist. |
| `ecc:flutter-reviewer` | Flutter and Dart code reviewer for widget best practices, state management. |
| `ecc:gan-evaluator` | GAN Harness — Evaluator agent. Tests the live running application via Playwright, scores against rubric. |
| `ecc:gan-generator` | GAN Harness — Generator agent. Implements features according to the spec. |
| `ecc:gan-planner` | GAN Harness — Planner agent. Expands a one-line prompt into a full product specification. |
| `ecc:general-purpose` | General-purpose agent for researching complex questions, searching code, multi-step tasks. |
| `ecc:go-build-resolver` | Go build, vet, and compilation error resolution specialist. |
| `ecc:go-reviewer` | Expert Go code reviewer specializing in idiomatic Go, concurrency patterns, error handling. |
| `ecc:healthcare-reviewer` | Reviews healthcare application code for clinical safety, CDSS accuracy, PHI compliance. |
| `ecc:homelab-architect` | Designs home and small-lab network plans from hardware inventory, goals, experience level. |
| `ecc:java-build-resolver` | Java/Maven/Gradle build, compilation, and dependency error resolution specialist. |
| `ecc:java-reviewer` | Expert Java code reviewer for Spring Boot and Quarkus projects. |
| `ecc:kotlin-build-resolver` | Kotlin/Gradle build, compilation, and dependency error resolution specialist. |
| `ecc:kotlin-reviewer` | Kotlin and Android/KMP code reviewer for idiomatic patterns, coroutine safety. |
| `ecc:loop-operator` | Operate autonomous agent loops, monitor progress, and intervene safely when loops stall. |
| `ecc:mcp-builder` | Builds custom MCP (Model Context Protocol) servers for your tools. |
| `ecc:php-reviewer` | Expert PHP code reviewer specializing in PSR-12 compliance, Eloquent ORM, security. |
| `ecc:planner` | Expert planning specialist for complex features and refactoring. |
| `ecc:pr-test-analyzer` | Review pull request test coverage quality and completeness. |
| `ecc:python-reviewer` | Expert Python code reviewer specializing in PEP 8, type hints, security, performance. |
| `ecc:react-build-resolver` | Diagnose and fix React build failures across Vite, webpack, Next.js, CRA, Parcel. |
| `ecc:react-reviewer` | Expert React/JSX code reviewer specializing in hook correctness, render performance, accessibility. |
| `ecc:refactor-cleaner` | Dead code cleanup and consolidation specialist. |
| `ecc:rust-build-resolver` | Rust build, compilation, and dependency error resolution specialist. |
| `ecc:rust-reviewer` | Expert Rust code reviewer specializing in ownership, lifetimes, error handling, unsafe usage. |
| `ecc:seo-specialist` | SEO specialist for technical SEO audits, on-page optimization, structured data, Core Web Vitals. |
| `ecc:sharp-edges-analyzer` | Evaluates APIs, configurations, and library interfaces for misuse resistance and footgun potential. |
| `ecc:swift-build-resolver` | Swift/Xcode build, compilation, and dependency error resolution specialist. |
| `ecc:swift-reviewer` | Expert Swift code reviewer specializing in protocol-oriented design, ARC, Swift Concurrency. |
| `ecc:typescript-reviewer` | Expert TypeScript/JavaScript code reviewer specializing in type safety, async correctness, security. |
| `ecc:vue-reviewer` | Expert Vue.js code reviewer specializing in Composition API correctness, reactivity, templates. |


---

## Quick lookup by task


| I want to… | Use… |
|---|---|
| Plan a feature before coding | `superpowers:brainstorming` → `ecc:plan` / `ecc:plan-prd` |
| Write the spec for a new feature | `superpowers:brainstorming` → `ecc:prp-plan` / `ecc:spec-miner` |
| Review my code (security/bugs) | `ecc:code-reviewer` (or `ecc:react-reviewer` for TSX) |
| Fix a build error | `ecc:react-build-resolver` / `<lang>-build-resolver` by language |
| Fix a Python/Django build | `ecc:python-build-resolver` or `ecc:django-build-resolver` |
| Write tests first (TDD) | `superpowers:test-driven-development` |
| Run tests before declaring done | `superpowers:verification-before-completion` |
| Make a new page look good | `ui-ux-pro-max:ui-ux-pro-max` (search) + `ui-ux-pro-max:design-system` |
| Build a shadcn/ui page | `ecc:ui-demo` |
| Drive a Lovable project | `mcp__lovable__send_message` + `mcp__lovable__get_diff` |
| Query a Supabase DB | `mcp__supabase__execute_sql` |
| Deploy to a cloud provider | Search context7 for your provider's MCP docs |
| Search codebase efficiently | `mcp__plugin_context-mode_context-mode__ctx_search` |
| Audit for security vulnerabilities | `ecc:security-review` or `trailofbits:sharp-edges` |
| Run many agents at once | `superpowers:dispatching-parallel-agents` or `Workflow` |
| Run a recurring task | `/loop` or `CronCreate` |
| Turn input into a knowledge graph | `graphify` |
| Trading/quant research | `trading-research` |
| Build an MCP server | `ecc:mcp-server-patterns` |
| Fix accessibility issues | `ecc:accessibility` or `ecc:a11y-architect` |
| Review AI agent systems | `ecc:agent-architecture-audit` or `ecc:sharp-edges` |
| Optimize performance | `ecc:performance-optimizer` |
| Database review | `ecc:database-reviewer` or `ecc:postgres-patterns` |
| Docker patterns | `ecc:docker-patterns` |
| Kubernetes patterns | `ecc:kubernetes-patterns` |
| RAG pipeline review | `ecc:rag-pipeline-reviewer` |
| Healthcare app review | `ecc:healthcare-reviewer` |
| React performance audit | `ecc:react-performance` |
| Vue Composition API audit | `ecc:vue-patterns` |
| Django patterns | `ecc:django-patterns` |
| FastAPI review | `ecc:fastapi-reviewer` |
| Mobile app clean architecture | `ecc:android-clean-architecture` |
| SEO audit | `ecc:seo` |
| Create video content | `hyperframes:hyperframes` |
| Configure keybindings | `keybindings-help` |
| Edit Claude settings.json | `update-config` |

---
