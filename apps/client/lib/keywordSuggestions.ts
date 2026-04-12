// Template-based suggestions for when no good semantic match exists in resume
// Used as fallback when similarity < 0.55

export const KEYWORD_TEMPLATES: Record<string, string[]> = {
  // Cloud & Infrastructure
  kubernetes: [
    "Orchestrated containerized microservices using Kubernetes in production",
    "Managed Kubernetes clusters for high-availability application deployments",
  ],
  terraform: [
    "Managed cloud infrastructure as code using Terraform across multiple environments",
    "Automated infrastructure provisioning with Terraform, reducing setup time by X%",
  ],
  aws: [
    "Deployed and maintained applications on AWS (EC2, S3, RDS, Lambda)",
    "Architected cloud solutions on AWS for scalability and cost optimization",
  ],
  docker: [
    "Containerized applications using Docker for consistent deployment environments",
    "Built and managed Docker containers and images for microservices architecture",
  ],
  gcp: [
    "Built and operated services on Google Cloud Platform for reliability and scale",
    "Designed cloud-native solutions leveraging GCP managed services",
  ],
  azure: [
    "Delivered enterprise workloads on Microsoft Azure with strong security posture",
    "Automated deployments and monitoring across Azure subscriptions",
  ],
  helm: [
    "Packaged and deployed services using Helm charts for Kubernetes releases",
    "Maintained Helm releases and rollbacks for production clusters",
  ],
  ansible: [
    "Automated configuration management with Ansible across server fleets",
    "Reduced provisioning time using Ansible playbooks and roles",
  ],
  // Backend
  python: [
    "Developed backend services in Python for high-throughput data processing",
    "Built APIs and workers in Python with strong testing and observability",
  ],
  java: [
    "Implemented enterprise services in Java with Spring ecosystem best practices",
    "Maintained JVM-based services with performance tuning and profiling",
  ],
  nodejs: [
    "Built scalable APIs with Node.js and modern JavaScript/TypeScript",
    "Delivered real-time features using Node.js event-driven architecture",
  ],
  golang: [
    "Authored performant microservices in Go with low latency and small footprints",
    "Built CLI tooling and services in Go for platform teams",
  ],
  rust: [
    "Developed systems components in Rust with memory safety and performance focus",
    "Contributed to performance-critical services written in Rust",
  ],
  fastapi: [
    "Shipped REST APIs with FastAPI including async I/O and OpenAPI documentation",
    "Built Python microservices using FastAPI with pydantic validation",
  ],
  django: [
    "Delivered web applications with Django including ORM and admin tooling",
    "Maintained Django services with migrations, caching, and security hardening",
  ],
  spring: [
    "Built Java services with Spring Boot and Spring Cloud patterns",
    "Implemented enterprise integrations using Spring ecosystem",
  ],
  graphql: [
    "Designed GraphQL schemas and resolvers for flexible client integrations",
    "Optimized GraphQL performance with batching and caching strategies",
  ],
  grpc: [
    "Implemented gRPC services for strongly typed inter-service communication",
    "Tuned protobuf contracts and streaming patterns for backend platforms",
  ],
  rest: [
    "Designed and documented RESTful APIs with versioning and error handling",
    "Integrated third-party REST APIs with retries and rate limiting",
  ],
  // Frontend
  react: [
    "Built interactive UIs with React, hooks, and component-driven architecture",
    "Improved performance of React apps with memoization and code splitting",
  ],
  vue: [
    "Developed SPAs with Vue.js and composition API patterns",
    "Shipped production frontends with Vue ecosystem tooling",
  ],
  angular: [
    "Maintained enterprise Angular applications with modules and RxJS",
    "Delivered Angular features with strong typing and testing practices",
  ],
  nextjs: [
    "Built SSR/SSG experiences with Next.js and React Server Components",
    "Optimized Next.js apps for SEO, performance, and edge delivery",
  ],
  typescript: [
    "Authored large TypeScript codebases with strict typing and shared libraries",
    "Reduced production defects using TypeScript across frontend and backend",
  ],
  // Data & ML
  spark: [
    "Processed large datasets with Apache Spark for ETL and analytics",
    "Tuned Spark jobs for cluster efficiency and cost control",
  ],
  kafka: [
    "Operated Kafka topics for event streaming and real-time pipelines",
    "Built consumers and producers with Kafka for reliable messaging",
  ],
  airflow: [
    "Orchestrated data pipelines with Apache Airflow and custom operators",
    "Monitored DAG reliability and SLAs in Airflow deployments",
  ],
  dbt: [
    "Modeled analytics data with dbt and version-controlled SQL transforms",
    "Implemented testing and documentation for dbt projects",
  ],
  snowflake: [
    "Designed warehouses and roles in Snowflake for analytics workloads",
    "Optimized Snowflake queries and storage for cost and performance",
  ],
  databricks: [
    "Ran notebooks and jobs on Databricks for ML and big data workflows",
    "Integrated Delta Lake patterns on Databricks for reliable tables",
  ],
  pytorch: [
    "Trained and deployed models with PyTorch for production ML use cases",
    "Experimented with architectures and loss functions in PyTorch",
  ],
  tensorflow: [
    "Built and served TensorFlow models with TF Serving or cloud endpoints",
    "Tuned training pipelines and distributed strategies in TensorFlow",
  ],
  pandas: [
    "Analyzed datasets with pandas for exploratory analysis and reporting",
    "Transformed tabular data with pandas in reproducible notebooks",
  ],
  numpy: [
    "Implemented numerical routines with NumPy for scientific computing",
    "Optimized array operations for performance-critical Python code",
  ],
  // DevOps & observability
  jenkins: [
    "Maintained Jenkins pipelines for CI/CD across multiple teams",
    "Reduced build times and flakiness in Jenkins job configurations",
  ],
  "github-actions": [
    "Automated CI/CD with GitHub Actions workflows and reusable actions",
    "Secured pipelines with OIDC and environment protections in GitHub Actions",
  ],
  prometheus: [
    "Instrumented services with Prometheus metrics and alerting rules",
    "Operated Prometheus stacks with recording rules and federation",
  ],
  grafana: [
    "Built Grafana dashboards for SLOs, on-call visibility, and capacity planning",
    "Integrated Grafana with multiple data sources for unified observability",
  ],
  elasticsearch: [
    "Operated Elasticsearch clusters for search and log analytics",
    "Tuned mappings and queries for relevance and performance",
  ],
  // Databases
  postgres: [
    "Designed schemas and migrations in PostgreSQL with strong indexing strategy",
    "Optimized PostgreSQL queries and connection pooling for scale",
  ],
  postgresql: [
    "Administered PostgreSQL with replication, backups, and monitoring",
    "Implemented row-level security and advanced SQL in PostgreSQL",
  ],
  mongodb: [
    "Modeled documents in MongoDB with indexing and aggregation pipelines",
    "Operated MongoDB clusters with sharding and replica sets",
  ],
  redis: [
    "Used Redis for caching, rate limiting, and pub/sub patterns",
    "Tuned Redis memory policies and persistence for production workloads",
  ],
  dynamodb: [
    "Designed single-table DynamoDB patterns for scalable access patterns",
    "Optimized DynamoDB capacity, GSIs, and conditional writes",
  ],
  mysql: [
    "Maintained MySQL schemas and replication for transactional workloads",
    "Profiled and tuned MySQL queries for latency-sensitive applications",
  ],
  sql: [
    "Wrote complex SQL for reporting, analytics, and transactional systems",
    "Improved query plans and indexes for relational databases",
  ],
  nosql: [
    "Selected and operated NoSQL stores for flexible schema and scale",
    "Balanced consistency models across NoSQL technologies",
  ],
  // Soft skills & process
  "stakeholder-management": [
    "Partnered with stakeholders to align roadmaps and deliver measurable outcomes",
    "Communicated trade-offs clearly to cross-functional stakeholders",
  ],
  agile: [
    "Delivered iteratively using Agile ceremonies and backlog prioritization",
    "Collaborated in Agile teams with continuous improvement mindset",
  ],
  scrum: [
    "Participated in Scrum teams with sprint planning and retrospectives",
    "Shipped increments reliably within Scrum cadence",
  ],
  "cross-functional": [
    "Led cross-functional initiatives spanning engineering, product, and design",
    "Facilitated collaboration across disciplines to unblock delivery",
  ],
  leadership: [
    "Led engineering initiatives with mentorship and technical direction",
    "Grew team capabilities through coaching and clear expectations",
  ],
  communication: [
    "Presented technical topics to diverse audiences with clarity",
    "Wrote documentation and RFCs that accelerated team alignment",
  ],
  // Extra tech
  cicd: [
    "Owned CI/CD pipelines from commit to production with automated checks",
    "Reduced release risk with progressive delivery and automated rollbacks",
  ],
  microservices: [
    "Designed microservices boundaries with clear contracts and observability",
    "Operated microservices with resilience patterns and service meshes",
  ],
  api: [
    "Owned API lifecycle including versioning, deprecation, and developer experience",
    "Implemented authentication, authorization, and rate limits for APIs",
  ],
  security: [
    "Applied security best practices including secrets management and threat modeling",
    "Conducted reviews for OWASP risks and dependency vulnerabilities",
  ],
  testing: [
    "Built automated test suites spanning unit, integration, and e2e coverage",
    "Drove quality with TDD practices and CI quality gates",
  ],
  linux: [
    "Administered Linux servers with systemd, networking, and hardening",
    "Debugged production issues using Linux tooling and observability",
  ],
  bash: [
    "Automated workflows with Bash scripting for developer productivity",
    "Maintained shell tooling for deployments and operational tasks",
  ],
  git: [
    "Collaborated using Git workflows with reviews and trunk-based practices",
    "Resolved complex merges and maintained clean repository history",
  ],
  nginx: [
    "Configured Nginx as reverse proxy with TLS termination and caching",
    "Tuned Nginx for performance and reliability at the edge",
  ],
  rabbitmq: [
    "Implemented messaging patterns with RabbitMQ exchanges and queues",
    "Operated RabbitMQ clusters with monitoring and HA configuration",
  ],
  flask: [
    "Shipped Python web services with Flask and production-ready patterns",
    "Maintained Flask APIs with blueprints, extensions, and testing",
  ],
  ruby: [
    "Built Ruby services and automation with Rails ecosystem patterns",
    "Delivered backend features in Ruby with performance and reliability focus",
  ],
  svelte: [
    "Developed reactive UIs with Svelte for fast and lightweight frontends",
    "Shipped production frontends using SvelteKit routing and adapters",
  ],
  // Default fallback for unknown keywords:
  _default: ["Applied {keyword} in professional environment to deliver business outcomes"],
};

export function getTemplateSuggestion(keyword: string): string {
  const key = keyword.toLowerCase().replace(/\s+/g, "-");
  const templates = KEYWORD_TEMPLATES[key] ?? KEYWORD_TEMPLATES[keyword.toLowerCase()] ?? KEYWORD_TEMPLATES._default;
  const template = templates[0];
  return template.replace("{keyword}", keyword);
}

// Generate suggestion by combining closest bullet + keyword
export function generateSuggestionFromBullet(keyword: string, closestBullet: string): string {
  // Strategy: append keyword naturally to existing bullet
  const bullet = closestBullet.replace(/[.!?]$/, ""); // strip trailing punctuation
  const k = keyword.toLowerCase();

  const appendages: Record<string, string> = {
    kubernetes: `${bullet} and Kubernetes for container orchestration`,
    terraform: `${bullet}, managing infrastructure as code with Terraform`,
    prometheus: `${bullet} with Prometheus monitoring and alerting`,
    grafana: `${bullet} with Grafana dashboards for observability`,
    helm: `${bullet}, including Helm-based Kubernetes releases`,
    docker: `${bullet}, leveraging Docker for portable deployments`,
    aws: `${bullet} on AWS infrastructure`,
    gcp: `${bullet} using Google Cloud services`,
    azure: `${bullet} within Azure environments`,
    python: `${bullet}, applying Python for implementation depth`,
    java: `${bullet} with Java ecosystem tooling`,
    react: `${bullet}, including React-based user interfaces`,
    typescript: `${bullet} with TypeScript for type-safe development`,
    graphql: `${bullet} and GraphQL-based integrations`,
    postgres: `${bullet} backed by PostgreSQL data modeling`,
    mongodb: `${bullet} with MongoDB document storage`,
    redis: `${bullet} using Redis for performance-sensitive caching`,
    kafka: `${bullet} integrated with Kafka event streams`,
    spark: `${bullet} in Spark-based data pipelines`,
    pytorch: `${bullet} with PyTorch for model development`,
    tensorflow: `${bullet} using TensorFlow for ML delivery`,
    agile: `${bullet}, working in Agile delivery cycles`,
    scrum: `${bullet} within Scrum team practices`,
  };

  return appendages[k] ?? `${bullet}, utilizing ${keyword} to enhance outcomes`;
}
