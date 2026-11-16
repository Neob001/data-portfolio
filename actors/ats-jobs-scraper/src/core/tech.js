// Technographics from job posts: a curated technology dictionary and a deterministic detector.
// Pure (no I/O). Used by the nightly index build (scripts/jobs_index/build_index.mjs via index_writer.js) to
// count, per company board, the open jobs whose title or description names each technology, and by the
// companies-by-technology readers (technographics.js) to resolve user input to technology slugs.
//
// Precision over recall. Every technology has:
//   a   case-insensitive literal aliases that are unambiguous ("snowflake computing", "kubernetes", "k8s")
//   cs  case-sensitive literals ("Snowflake", "Looker", "dbt"), optionally with context rules
//   w   WEAK case-sensitive literals for ambiguous names ("Go", "R", "Spark", "Chef"): they count only in a
//       list context (", Go," / "Python, Go and Rust" / "Go/Rust" / a bullet of its own) AND when the same job
//       also names (strongly) another technology from `req` (slugs or "@category").
// Context rules (on an alias object {w, pre, post, npre, npost}): RegExps tested on the 30 characters before
// (anchored at $) / after (anchored at ^) the match; pre/post must match, npre/npost must not.
// One combined case-insensitive regex of all literals runs once per job; case and context are then checked
// in JS for the (few) hits. Word boundaries are checked by hand (letters, digits, "_" on both sides; "+", "#"
// and ".x" on the right, so "C" never matches "C++" and "Vue" never matches "Vue.js").

export const TECH_DICTIONARY_VERSION = 1;

export const TECH_CATEGORIES = {
  data_warehouse: 'Data warehouse & lakehouse',
  data_integration: 'Data integration & orchestration',
  data_processing: 'Big data & streaming',
  databases: 'Databases',
  bi_analytics: 'BI & analytics',
  product_analytics: 'Product & web analytics',
  ai_ml: 'AI & machine learning',
  cloud: 'Cloud platforms & services',
  devops: 'DevOps & infrastructure as code',
  observability: 'Monitoring & observability',
  security: 'Security & identity',
  languages: 'Programming languages',
  frameworks: 'Frameworks & libraries',
  mobile: 'Mobile development',
  testing: 'Testing & QA',
  crm_sales: 'CRM & sales tools',
  marketing: 'Marketing automation & adtech',
  customer_support: 'Customer support & CX',
  ecommerce_payments: 'E-commerce & payments',
  erp_finance: 'ERP & finance',
  hr_payroll: 'HR & payroll',
  collaboration: 'Collaboration & productivity',
  design_cad: 'Design, 3D & CAD',
  it_infrastructure: 'IT infrastructure & ITSM',
  automation: 'Low-code, RPA & integration platforms',
  embedded_hardware: 'Embedded & hardware design',
  healthcare_it: 'Healthcare & life-sciences IT',
};

// ---------------------------------------------------------------- context helpers
/** Left side of a list item: start of text/line (optionally a bullet), a separator, or and/or/&. */
const LIST_PRE = /(?:^|\n[ \t]*(?:[-*•·●▪–]\s*)?|[,;/(|:•·]\s*|\s(?:and|or|&)\s+|\b(?:in|using|with|including|like)\s+)$/;
/** Right side of a list item: a separator, and/or/&, end of sentence or line. */
const LIST_POST = /^(?:\s*[,;/)|]|\s*\n|\s+(?:and|or|&)\s|\.(?:\s|$)|$)/;
const LIST = { pre: LIST_PRE, post: LIST_POST };
/** Preceded by a capitalized word (a person's name: "Sarah Jenkins", "Dr. Ruby"). */
const AFTER_NAME = /(?:[A-Z][a-z]+|Mr\.|Ms\.|Mrs\.|Dr\.)\s+$/;
/** Followed by a capitalized word (first name use: "Ruby Smith", "Julia Roberts"). */
const BEFORE_NAME = /^\s+[A-Z][a-z]+/;
const lw = (w, extra = {}) => ({ w, ...LIST, ...extra });

const LANGS = '@languages';

// ---------------------------------------------------------------- the dictionary
// [slug, name, category, spec]
const RAW = [
  // ---- data warehouse & lakehouse
  ['snowflake', 'Snowflake', 'data_warehouse', { a: ['snowflake computing', 'snowflake data cloud', 'snowpark', 'snowpipe', 'snowsql'], cs: [{ w: 'Snowflake', npost: /^[\s-]+(?:schemas?|model|design)\b/i }] }],
  ['bigquery', 'Google BigQuery', 'data_warehouse', { a: ['bigquery', 'big query'], also: ['google-cloud'] }],
  ['redshift', 'Amazon Redshift', 'data_warehouse', { a: ['amazon redshift', 'aws redshift'], cs: [{ w: 'Redshift', npre: /(?:Octane|Arnold|V-?Ray|render(?:er|ing|s)?|Cinema 4D|C4D|Houdini|Maya)[\s,/&]*$/i, npost: /^[\s,/&]*(?:Octane|Arnold|V-?Ray|render|Cinema|C4D|Houdini|Maya)/i }], also: ['aws'] }],
  ['databricks', 'Databricks', 'data_warehouse', { a: ['databricks', 'unity catalog'] }],
  ['azure-synapse', 'Azure Synapse Analytics', 'data_warehouse', { a: ['azure synapse', 'synapse analytics'], also: ['azure'] }],
  ['microsoft-fabric', 'Microsoft Fabric', 'data_warehouse', { a: ['microsoft fabric', 'ms fabric'] }],
  ['teradata', 'Teradata', 'data_warehouse', { a: ['teradata'] }],
  ['clickhouse', 'ClickHouse', 'data_warehouse', { a: ['clickhouse'] }],
  ['vertica', 'Vertica', 'data_warehouse', { cs: ['Vertica'] }],
  ['firebolt', 'Firebolt', 'data_warehouse', { cs: ['Firebolt'] }],
  ['singlestore', 'SingleStore', 'data_warehouse', { a: ['singlestore', 'memsql'] }],
  ['dremio', 'Dremio', 'data_warehouse', { a: ['dremio'] }],
  ['trino', 'Trino', 'data_warehouse', { cs: ['Trino'], a: ['trinodb'] }],
  ['presto', 'Presto', 'data_warehouse', { a: ['prestodb', 'presto sql'], w: [lw('Presto')], req: ['@data_warehouse', '@data_processing', '@databases'] }],
  ['starburst', 'Starburst', 'data_warehouse', { a: ['starburst data', 'starburst galaxy'], w: [lw('Starburst')], req: ['trino', 'presto', '@data_warehouse'] }],
  ['delta-lake', 'Delta Lake', 'data_warehouse', { a: ['delta lake'] }],
  ['apache-iceberg', 'Apache Iceberg', 'data_warehouse', { a: ['apache iceberg'], w: [lw('Iceberg')], req: ['@data_warehouse', '@data_processing'] }],
  ['apache-hudi', 'Apache Hudi', 'data_warehouse', { a: ['apache hudi'], cs: ['Hudi'] }],
  ['greenplum', 'Greenplum', 'data_warehouse', { a: ['greenplum'] }],
  ['netezza', 'Netezza', 'data_warehouse', { a: ['netezza'] }],

  // ---- data integration & orchestration
  ['dbt', 'dbt', 'data_integration', { a: ['dbt labs', 'dbt cloud', 'dbt core', 'data build tool'], cs: [{ w: 'dbt', npost: /^\s*(?:therap|skills)/i }, { w: 'DBT', pre: /(?:Snowflake|SQL|Airflow|BigQuery|Looker|ELT|Fivetran|Redshift|Databricks)[\s,/&()-]{1,12}$/, npost: /^\s*(?:therap|skills)/i }, { w: 'DBT', post: /^[\s,/&()-]{1,12}(?:Snowflake|SQL|Airflow|BigQuery|Looker|ELT|Fivetran|Redshift|Databricks)/ }] }],
  ['airflow', 'Apache Airflow', 'data_integration', { a: ['apache airflow', 'airflow dags', 'cloud composer', 'amazon mwaa'], cs: [{ w: 'Airflow', npost: /^\s+(?:management|measurement|rates?|systems?|sensors?|control|patterns?|test)\b/i }] }],
  ['dagster', 'Dagster', 'data_integration', { a: ['dagster'] }],
  ['prefect', 'Prefect', 'data_integration', { w: [lw('Prefect')], req: ['@data_integration', '@data_warehouse', 'python'] }],
  ['fivetran', 'Fivetran', 'data_integration', { a: ['fivetran'] }],
  ['airbyte', 'Airbyte', 'data_integration', { a: ['airbyte'] }],
  ['stitch', 'Stitch', 'data_integration', { a: ['stitch data', 'stitchdata'] }],
  ['matillion', 'Matillion', 'data_integration', { a: ['matillion'] }],
  ['informatica', 'Informatica', 'data_integration', { a: ['informatica', 'informatica powercenter', 'iics'] }],
  ['talend', 'Talend', 'data_integration', { a: ['talend'] }],
  ['ssis', 'SSIS', 'data_integration', { a: ['ssis', 'sql server integration services'], also: ['sql-server'] }],
  ['azure-data-factory', 'Azure Data Factory', 'data_integration', { a: ['azure data factory'], cs: [{ w: 'ADF', pre: /(?:Azure|Databricks|Synapse|SQL)[\s,/&()-]{1,10}$/ }, { w: 'ADF', post: /^[\s,/&()-]{1,10}(?:Azure|Databricks|Synapse|SQL)/ }], also: ['azure'] }],
  ['aws-glue', 'AWS Glue', 'data_integration', { a: ['aws glue', 'amazon glue'], also: ['aws'] }],
  ['nifi', 'Apache NiFi', 'data_integration', { a: ['apache nifi'], cs: ['NiFi'] }],
  ['hightouch', 'Hightouch', 'data_integration', { a: ['hightouch'] }],
  ['rudderstack', 'RudderStack', 'data_integration', { a: ['rudderstack'] }],
  ['debezium', 'Debezium', 'data_integration', { a: ['debezium'] }],
  ['alteryx', 'Alteryx', 'data_integration', { a: ['alteryx'] }],
  ['collibra', 'Collibra', 'data_integration', { a: ['collibra'] }],
  ['alation', 'Alation', 'data_integration', { cs: ['Alation'] }],
  ['boomi', 'Boomi', 'automation', { a: ['dell boomi', 'boomi atomsphere'], cs: ['Boomi'] }],
  ['mulesoft', 'MuleSoft', 'automation', { a: ['mulesoft', 'anypoint platform'] }],
  ['workato', 'Workato', 'automation', { a: ['workato'] }],
  ['zapier', 'Zapier', 'automation', { a: ['zapier'] }],
  ['celigo', 'Celigo', 'automation', { a: ['celigo'] }],
  ['n8n', 'n8n', 'automation', { a: ['n8n'] }],
  ['make-com', 'Make (Integromat)', 'automation', { a: ['integromat', 'make.com'] }],
  ['tray-io', 'Tray.io', 'automation', { a: ['tray.io'] }],

  // ---- big data & streaming
  ['spark', 'Apache Spark', 'data_processing', { a: ['apache spark', 'pyspark', 'spark sql', 'sparksql', 'spark streaming', 'structured streaming', 'sparkr'], w: [lw('Spark')], req: ['@data_processing', '@data_warehouse', '@data_integration', 'python', 'scala', 'java', 'sql'] }],
  ['hadoop', 'Hadoop', 'data_processing', { a: ['hadoop', 'hdfs', 'mapreduce', 'cloudera', 'hortonworks'] }],
  ['hive', 'Apache Hive', 'data_processing', { a: ['apache hive', 'hiveql', 'hive metastore'], w: [lw('Hive')], req: ['@data_processing', '@data_warehouse'] }],
  ['kafka', 'Apache Kafka', 'data_processing', { a: ['apache kafka', 'kafka streams', 'kafka connect', 'confluent kafka', 'confluent platform', 'confluent cloud', 'ksqldb'], cs: ['Kafka'], npre: /Franz\s+$/ }],
  ['flink', 'Apache Flink', 'data_processing', { a: ['apache flink', 'pyflink'], cs: ['Flink'] }],
  ['apache-beam', 'Apache Beam', 'data_processing', { a: ['apache beam'], also: [] }],
  ['google-dataflow', 'Google Cloud Dataflow', 'data_processing', { a: ['cloud dataflow', 'google dataflow', 'gcp dataflow'], also: ['google-cloud'] }],
  ['kinesis', 'Amazon Kinesis', 'data_processing', { a: ['amazon kinesis', 'aws kinesis', 'kinesis data streams', 'kinesis firehose'], cs: ['Kinesis'], also: ['aws'] }],
  ['pulsar', 'Apache Pulsar', 'data_processing', { a: ['apache pulsar'] }],
  ['rabbitmq', 'RabbitMQ', 'data_processing', { a: ['rabbitmq', 'rabbit mq'] }],
  ['activemq', 'ActiveMQ', 'data_processing', { a: ['activemq', 'active mq'] }],
  ['google-pubsub', 'Google Pub/Sub', 'data_processing', { a: ['google pub/sub', 'gcp pub/sub', 'cloud pub/sub', 'google pubsub'], also: ['google-cloud'] }],
  ['amazon-emr', 'Amazon EMR', 'data_processing', { a: ['amazon emr', 'aws emr', 'elastic mapreduce'], also: ['aws'] }],
  ['dask', 'Dask', 'data_processing', { w: [lw('Dask')], req: ['python', '@ai_ml', '@data_processing'] }],
  ['polars', 'Polars', 'data_processing', { w: [lw('Polars')], req: ['python', 'rust'] }],

  // ---- databases
  ['postgresql', 'PostgreSQL', 'databases', { a: ['postgresql', 'postgres', 'postgressql', 'pgsql', 'aurora postgresql'] }],
  ['mysql', 'MySQL', 'databases', { a: ['mysql', 'aurora mysql'] }],
  ['mariadb', 'MariaDB', 'databases', { a: ['mariadb'] }],
  ['sql-server', 'Microsoft SQL Server', 'databases', { a: ['sql server', 'mssql', 'ms sql', 'ms-sql', 't-sql', 'tsql', 'transact-sql', 'azure sql'] }],
  ['oracle-database', 'Oracle Database', 'databases', { a: ['oracle database', 'oracle db', 'oracle rdbms', 'pl/sql', 'plsql', 'oracle 19c', 'oracle 12c', 'oracle exadata', 'oracle rac', 'oracle sql'] }],
  ['ibm-db2', 'IBM Db2', 'databases', { a: ['ibm db2', 'db2'] }],
  ['mongodb', 'MongoDB', 'databases', { a: ['mongodb', 'mongo db', 'mongodb atlas'], cs: ['Mongo'] }],
  ['cassandra', 'Apache Cassandra', 'databases', { a: ['apache cassandra', 'datastax'], w: [lw('Cassandra')], req: ['@databases', '@data_processing'] }],
  ['dynamodb', 'Amazon DynamoDB', 'databases', { a: ['dynamodb', 'dynamo db'], also: ['aws'] }],
  ['redis', 'Redis', 'databases', { a: ['redis'] }],
  ['memcached', 'Memcached', 'databases', { a: ['memcached'] }],
  ['elasticsearch', 'Elasticsearch', 'databases', { a: ['elasticsearch', 'elastic search', 'elk stack', 'elastic stack'], cs: ['ELK'] }],
  ['opensearch', 'OpenSearch', 'databases', { a: ['opensearch'] }],
  ['neo4j', 'Neo4j', 'databases', { a: ['neo4j'] }],
  ['couchbase', 'Couchbase', 'databases', { a: ['couchbase', 'couchdb'] }],
  ['cockroachdb', 'CockroachDB', 'databases', { a: ['cockroachdb', 'cockroach db'] }],
  ['firebase', 'Firebase', 'databases', { a: ['firebase', 'firestore'] }],
  ['supabase', 'Supabase', 'databases', { a: ['supabase'] }],
  ['sqlite', 'SQLite', 'databases', { a: ['sqlite'] }],
  ['cosmos-db', 'Azure Cosmos DB', 'databases', { a: ['cosmos db', 'cosmosdb'], also: ['azure'] }],
  ['timescaledb', 'TimescaleDB', 'databases', { a: ['timescaledb', 'timescale db'] }],
  ['influxdb', 'InfluxDB', 'databases', { a: ['influxdb', 'influx db'] }],
  ['pinecone', 'Pinecone', 'databases', { a: ['pinecone db'], w: [lw('Pinecone')], req: ['@ai_ml', '@databases', 'python'] }],
  ['weaviate', 'Weaviate', 'databases', { a: ['weaviate'] }],
  ['milvus', 'Milvus', 'databases', { a: ['milvus'] }],
  ['pgvector', 'pgvector', 'databases', { a: ['pgvector'] }],
  ['sap-hana', 'SAP HANA', 'databases', { a: ['sap hana'], cs: ['HANA'], also: ['sap'] }],

  // ---- BI & analytics
  ['tableau', 'Tableau', 'bi_analytics', { a: ['tableau desktop', 'tableau server', 'tableau cloud', 'tableau prep'], cs: [{ w: 'Tableau', npost: /^\s+(?:de|des|du|d['’]|r[ée]capitulatif)\b/i }] }],
  ['power-bi', 'Microsoft Power BI', 'bi_analytics', { a: ['power bi', 'powerbi', 'power-bi', 'power query'] }],
  ['looker', 'Looker', 'bi_analytics', { a: ['lookml'], cs: ['Looker'], also: [] }],
  ['looker-studio', 'Looker Studio', 'bi_analytics', { a: ['looker studio', 'google data studio', 'data studio'] }],
  ['qlik', 'Qlik', 'bi_analytics', { a: ['qlik', 'qlikview', 'qlik sense', 'qliksense'] }],
  ['microstrategy', 'MicroStrategy', 'bi_analytics', { a: ['microstrategy'] }],
  ['domo', 'Domo', 'bi_analytics', { w: [lw('Domo')], req: ['@bi_analytics', '@data_warehouse', 'sql'] }],
  ['thoughtspot', 'ThoughtSpot', 'bi_analytics', { a: ['thoughtspot'] }],
  ['sisense', 'Sisense', 'bi_analytics', { a: ['sisense'] }],
  ['metabase', 'Metabase', 'bi_analytics', { a: ['metabase'] }],
  ['apache-superset', 'Apache Superset', 'bi_analytics', { a: ['apache superset', 'preset.io'] }],
  ['sigma-computing', 'Sigma Computing', 'bi_analytics', { a: ['sigma computing'] }],
  ['mode-analytics', 'Mode Analytics', 'bi_analytics', { a: ['mode analytics'] }],
  ['hex', 'Hex', 'bi_analytics', { a: ['hex.tech'] }],
  ['excel', 'Microsoft Excel', 'bi_analytics', { a: ['microsoft excel', 'ms excel', 'ms-excel', 'excel vba', 'advanced excel', 'excel spreadsheets', 'vlookup', 'xlookup', 'pivot tables'], cs: [{ w: 'Excel', npost: /^\s+(?:at|in|as|beyond|when|within|under)\b/i }] }],
  ['google-sheets', 'Google Sheets', 'bi_analytics', { a: ['google sheets', 'gsheets'] }],
  ['sas', 'SAS', 'bi_analytics', { a: ['sas programming', 'sas enterprise guide', 'sas viya', 'base sas', 'sas/stat', 'sas macro', 'sas eg', 'sas certified'], w: [lw('SAS', { npost: /^\s*(?:,\s*)?(?:Inc|Institute)\b/ })], req: [LANGS, 'spss', 'stata', 'sql', 'excel'] }],
  ['spss', 'IBM SPSS', 'bi_analytics', { a: ['spss'] }],
  ['stata', 'Stata', 'bi_analytics', { cs: ['Stata', 'STATA'] }],
  ['ssrs', 'SSRS', 'bi_analytics', { a: ['ssrs', 'sql server reporting services'], also: ['sql-server'] }],
  ['crystal-reports', 'Crystal Reports', 'bi_analytics', { a: ['crystal reports'] }],

  // ---- product & web analytics
  ['google-analytics', 'Google Analytics', 'product_analytics', { a: ['google analytics', 'ga4', 'universal analytics'] }],
  ['adobe-analytics', 'Adobe Analytics', 'product_analytics', { a: ['adobe analytics', 'omniture', 'sitecatalyst'] }],
  ['google-tag-manager', 'Google Tag Manager', 'product_analytics', { a: ['google tag manager', 'gtm container'] }],
  ['mixpanel', 'Mixpanel', 'product_analytics', { a: ['mixpanel'] }],
  ['amplitude', 'Amplitude', 'product_analytics', { a: ['amplitude analytics'], w: [lw('Amplitude')], req: ['@product_analytics', '@bi_analytics', 'segment', 'sql'] }],
  ['heap', 'Heap', 'product_analytics', { a: ['heap analytics', 'heap.io'] }],
  ['segment', 'Segment', 'product_analytics', { a: ['twilio segment', 'segment.io', 'segment.com', 'segment cdp'], w: [lw('Segment')], req: ['@product_analytics', '@marketing', '@data_integration'] }],
  ['hotjar', 'Hotjar', 'product_analytics', { a: ['hotjar'] }],
  ['fullstory', 'FullStory', 'product_analytics', { a: ['fullstory'] }],
  ['pendo', 'Pendo', 'product_analytics', { a: ['pendo.io'], cs: ['Pendo'] }],
  ['snowplow', 'Snowplow', 'product_analytics', { a: ['snowplow analytics'], w: [lw('Snowplow')], req: ['@product_analytics', '@data_warehouse', '@data_integration'] }],
  ['posthog', 'PostHog', 'product_analytics', { a: ['posthog'] }],
  ['optimizely', 'Optimizely', 'product_analytics', { a: ['optimizely'] }],
  ['launchdarkly', 'LaunchDarkly', 'product_analytics', { a: ['launchdarkly'] }],

  // ---- AI & ML
  ['tensorflow', 'TensorFlow', 'ai_ml', { a: ['tensorflow', 'tensor flow', 'tf.keras'] }],
  ['pytorch', 'PyTorch', 'ai_ml', { a: ['pytorch', 'py torch', 'torchvision', 'pytorch lightning'] }],
  ['keras', 'Keras', 'ai_ml', { a: ['keras'] }],
  ['scikit-learn', 'scikit-learn', 'ai_ml', { a: ['scikit-learn', 'scikit learn', 'sklearn', 'scikitlearn'] }],
  ['xgboost', 'XGBoost / LightGBM', 'ai_ml', { a: ['xgboost', 'lightgbm', 'catboost'] }],
  ['hugging-face', 'Hugging Face', 'ai_ml', { a: ['hugging face', 'huggingface', 'hf transformers'] }],
  ['langchain', 'LangChain', 'ai_ml', { a: ['langchain', 'langgraph', 'langsmith'] }],
  ['llamaindex', 'LlamaIndex', 'ai_ml', { a: ['llamaindex', 'llama index', 'llama-index'] }],
  ['openai', 'OpenAI', 'ai_ml', { a: ['openai', 'open ai', 'chatgpt', 'gpt-4', 'gpt-4o', 'gpt-5', 'gpt-3.5', 'azure openai'] }],
  ['anthropic', 'Anthropic Claude', 'ai_ml', { a: ['anthropic', 'claude code', 'claude api'], w: [lw('Claude')], req: ['openai', 'gemini', 'llm', '@ai_ml'] }],
  ['gemini', 'Google Gemini', 'ai_ml', { a: ['google gemini', 'gemini pro', 'gemini api'], w: [lw('Gemini')], req: ['openai', 'anthropic', 'llm', 'vertex-ai'] }],
  ['llm', 'Generative AI / LLMs', 'ai_ml', { a: ['large language model', 'large language models', 'llms', 'genai', 'gen ai', 'generative ai', 'retrieval-augmented generation', 'retrieval augmented generation', 'prompt engineering'], cs: [{ w: 'LLM', npre: /(?:J\.?D\.?|LL\.?B\.?|law|degree|masters?|master's)[\s,/&()-]*$/i, npost: /^[\s,/&()-]*(?:degree|in\s+(?:tax|law|taxation)|from|program|J\.?D)/i }, { w: 'RAG', npost: /^\s*(?:status|rating|reports?)\b/i, npre: /(?:Red|Amber|Green)[\s,/-]*$/ }] }],
  ['mlflow', 'MLflow', 'ai_ml', { a: ['mlflow'] }],
  ['kubeflow', 'Kubeflow', 'ai_ml', { a: ['kubeflow'] }],
  ['weights-and-biases', 'Weights & Biases', 'ai_ml', { a: ['weights & biases', 'weights and biases', 'wandb'] }],
  ['sagemaker', 'Amazon SageMaker', 'ai_ml', { a: ['sagemaker', 'sage maker'], also: ['aws'] }],
  ['vertex-ai', 'Google Vertex AI', 'ai_ml', { a: ['vertex ai', 'vertexai'], also: ['google-cloud'] }],
  ['azure-ml', 'Azure Machine Learning', 'ai_ml', { a: ['azure machine learning', 'azure ml', 'azure ai studio', 'azure ai foundry'], also: ['azure'] }],
  ['amazon-bedrock', 'Amazon Bedrock', 'ai_ml', { a: ['amazon bedrock', 'aws bedrock'], also: ['aws'] }],
  ['databricks-ml', 'Databricks Mosaic AI', 'ai_ml', { a: ['mosaic ai', 'mosaicml'] }],
  ['spacy', 'spaCy', 'ai_ml', { a: ['spacy'] }],
  ['nltk', 'NLTK', 'ai_ml', { a: ['nltk'] }],
  ['opencv', 'OpenCV', 'ai_ml', { a: ['opencv'] }],
  ['cuda', 'NVIDIA CUDA', 'ai_ml', { a: ['cuda', 'cudnn', 'tensorrt'] }],
  ['jax', 'JAX', 'ai_ml', { w: [lw('JAX')], req: ['pytorch', 'tensorflow', 'python', '@ai_ml'] }],
  ['pandas', 'pandas', 'ai_ml', { w: [lw('pandas'), lw('Pandas')], req: ['python', '@ai_ml', '@data_processing'] }],
  ['numpy', 'NumPy / SciPy', 'ai_ml', { a: ['numpy', 'scipy'] }],
  ['jupyter', 'Jupyter', 'ai_ml', { a: ['jupyter', 'jupyterlab', 'jupyter notebooks', 'ipython'] }],
  ['dataiku', 'Dataiku', 'ai_ml', { a: ['dataiku'] }],
  ['datarobot', 'DataRobot', 'ai_ml', { a: ['datarobot'] }],
  ['h2o-ai', 'H2O.ai', 'ai_ml', { a: ['h2o.ai', 'h2o driverless'] }],
  ['ray', 'Ray (Anyscale)', 'ai_ml', { a: ['anyscale', 'ray serve', 'ray tune', 'ray train'] }],
  ['vllm', 'vLLM', 'ai_ml', { a: ['vllm'] }],

  // ---- cloud
  ['aws', 'Amazon Web Services (AWS)', 'cloud', { a: ['amazon web services', 'aws cloud', 'aws certified', 'aws lambda', 'amazon s3', 'aws s3', 'amazon ec2', 'aws ec2', 'ec2', 'cloudformation', 'aws cdk', 'amazon ecs', 'aws ecs', 'amazon eks', 'aws eks', 'aws fargate', 'amazon rds', 'aws rds', 'amazon aurora', 'aws iam', 'amazon sqs', 'aws sqs', 'amazon sns', 'cloudwatch', 'amazon athena', 'aws athena', 'aws step functions'], cs: ['AWS'] }],
  ['azure', 'Microsoft Azure', 'cloud', { a: ['microsoft azure', 'azure cloud', 'azure devops', 'azure functions', 'azure kubernetes service', 'azure blob', 'azure storage', 'azure app service', 'azure sql database', 'azure certified', 'arm templates', 'bicep templates'], cs: ['Azure', 'AZURE', 'AKS'] }],
  ['google-cloud', 'Google Cloud (GCP)', 'cloud', { a: ['google cloud', 'google cloud platform', 'gcloud', 'google kubernetes engine', 'google cloud run', 'google cloud functions', 'google cloud storage', 'cloud spanner', 'google cloud sql', 'dataproc'], cs: ['GKE'], w: [lw('GCP', { npre: /(?:ICH|GLP|GMP|GCLP|GDP|GVP)[\s,/&-]*$/, npost: /^[\s,/&-]*(?:GLP|GMP|GCLP|GDP|GVP|ICH|guidelines?|compliance|regulations?|training|certifi)/i })], req: ['aws', 'azure', 'kubernetes', 'terraform', 'docker', 'bigquery', LANGS, '@devops', '@data_warehouse'] }],
  ['oracle-cloud', 'Oracle Cloud Infrastructure', 'cloud', { a: ['oracle cloud infrastructure', 'oci cloud'], w: [lw('OCI')], req: ['aws', 'azure', 'google-cloud', 'oracle-database', 'kubernetes', 'terraform'] }],
  ['ibm-cloud', 'IBM Cloud', 'cloud', { a: ['ibm cloud'] }],
  ['alibaba-cloud', 'Alibaba Cloud', 'cloud', { a: ['alibaba cloud', 'aliyun'] }],
  ['digitalocean', 'DigitalOcean', 'cloud', { a: ['digitalocean', 'digital ocean'] }],
  ['heroku', 'Heroku', 'cloud', { a: ['heroku'] }],
  ['vercel', 'Vercel', 'cloud', { a: ['vercel'] }],
  ['netlify', 'Netlify', 'cloud', { a: ['netlify'] }],
  ['cloudflare', 'Cloudflare', 'cloud', { a: ['cloudflare'] }],
  ['akamai', 'Akamai', 'cloud', { a: ['akamai'] }],
  ['fastly', 'Fastly', 'cloud', { cs: ['Fastly'] }],
  ['openstack', 'OpenStack', 'cloud', { a: ['openstack'] }],

  // ---- DevOps & infrastructure as code
  ['docker', 'Docker', 'devops', { a: ['docker', 'dockerfile', 'docker compose', 'docker-compose'] }],
  ['kubernetes', 'Kubernetes', 'devops', { a: ['kubernetes', 'k8s', 'kubectl', 'k3s'] }],
  ['openshift', 'Red Hat OpenShift', 'devops', { a: ['openshift'] }],
  ['terraform', 'Terraform', 'devops', { a: ['terraform', 'opentofu', 'terragrunt'] }],
  ['pulumi', 'Pulumi', 'devops', { a: ['pulumi'] }],
  ['ansible', 'Ansible', 'devops', { a: ['ansible'] }],
  ['chef', 'Chef', 'devops', { a: ['chef infra', 'opscode chef', 'chef cookbooks'], w: [lw('Chef')], req: ['ansible', 'puppet', 'terraform', 'saltstack', 'jenkins', 'docker'] }],
  ['puppet', 'Puppet', 'devops', { a: ['puppet enterprise'], w: [lw('Puppet')], req: ['ansible', 'chef', 'terraform', 'saltstack', 'jenkins', 'docker', 'linux'] }],
  ['saltstack', 'SaltStack', 'devops', { a: ['saltstack', 'salt stack'] }],
  ['helm', 'Helm', 'devops', { a: ['helm charts', 'helm chart'], w: [lw('Helm')], req: ['kubernetes'] }],
  ['argo-cd', 'Argo CD', 'devops', { a: ['argocd', 'argo cd', 'argo workflows', 'argo rollouts'] }],
  ['flux-cd', 'Flux CD', 'devops', { a: ['fluxcd', 'flux cd'] }],
  ['jenkins', 'Jenkins', 'devops', { a: ['jenkinsfile', 'jenkins pipelines', 'jenkins pipeline'], cs: [{ w: 'Jenkins', npre: AFTER_NAME }] }],
  ['github-actions', 'GitHub Actions', 'devops', { a: ['github actions', 'github action', 'gh actions'], also: ['github'] }],
  ['gitlab-ci', 'GitLab CI/CD', 'devops', { a: ['gitlab ci', 'gitlab-ci', 'gitlab ci/cd', 'gitlab pipelines'], also: ['gitlab'] }],
  ['github', 'GitHub', 'devops', { a: ['github', 'github enterprise', 'github copilot'] }],
  ['gitlab', 'GitLab', 'devops', { a: ['gitlab'] }],
  ['bitbucket', 'Bitbucket', 'devops', { a: ['bitbucket'] }],
  ['circleci', 'CircleCI', 'devops', { a: ['circleci', 'circle ci'] }],
  ['travis-ci', 'Travis CI', 'devops', { a: ['travis ci', 'travis-ci'] }],
  ['teamcity', 'TeamCity', 'devops', { a: ['teamcity'] }],
  ['azure-pipelines', 'Azure Pipelines', 'devops', { a: ['azure pipelines'], also: ['azure'] }],
  ['spinnaker', 'Spinnaker', 'devops', { cs: ['Spinnaker'] }],
  ['bazel', 'Bazel', 'devops', { cs: ['Bazel'] }],
  ['maven', 'Apache Maven', 'devops', { a: ['apache maven'], w: [lw('Maven')], req: ['java', 'gradle', 'jenkins', 'spring'] }],
  ['gradle', 'Gradle', 'devops', { a: ['gradle'] }],
  ['istio', 'Istio', 'devops', { a: ['istio'] }],
  ['linkerd', 'Linkerd', 'devops', { a: ['linkerd'] }],
  ['envoy', 'Envoy Proxy', 'devops', { a: ['envoy proxy'], w: [lw('Envoy')], req: ['kubernetes', 'istio', 'nginx'] }],
  ['nginx', 'NGINX', 'devops', { a: ['nginx'] }],
  ['hashicorp-vault', 'HashiCorp Vault', 'security', { a: ['hashicorp vault'], w: [lw('Vault')], req: ['terraform', 'consul', 'kubernetes', 'nomad'] }],
  ['consul', 'HashiCorp Consul', 'devops', { a: ['hashicorp consul'], w: [lw('Consul')], req: ['terraform', 'hashicorp-vault', 'kubernetes', 'nomad'] }],
  ['nomad', 'HashiCorp Nomad', 'devops', { a: ['hashicorp nomad'], w: [lw('Nomad')], req: ['terraform', 'hashicorp-vault', 'consul', 'kubernetes'] }],
  ['packer', 'HashiCorp Packer', 'devops', { a: ['hashicorp packer'], w: [lw('Packer')], req: ['terraform', 'ansible', 'hashicorp-vault', 'aws'] }],
  ['vagrant', 'Vagrant', 'devops', { w: [lw('Vagrant')], req: ['terraform', 'ansible', 'docker', 'packer', 'puppet', 'chef'] }],
  ['backstage', 'Backstage', 'devops', { a: ['backstage.io', 'spotify backstage'] }],

  // ---- monitoring & observability
  ['datadog', 'Datadog', 'observability', { a: ['datadog'] }],
  ['new-relic', 'New Relic', 'observability', { a: ['new relic', 'newrelic'] }],
  ['dynatrace', 'Dynatrace', 'observability', { a: ['dynatrace'] }],
  ['appdynamics', 'AppDynamics', 'observability', { a: ['appdynamics'] }],
  ['splunk', 'Splunk', 'observability', { a: ['splunk'] }],
  ['sumo-logic', 'Sumo Logic', 'observability', { a: ['sumo logic', 'sumologic'] }],
  ['prometheus', 'Prometheus', 'observability', { cs: ['Prometheus'], a: ['promql'] }],
  ['grafana', 'Grafana', 'observability', { a: ['grafana'] }],
  ['opentelemetry', 'OpenTelemetry', 'observability', { a: ['opentelemetry', 'open telemetry'] }],
  ['pagerduty', 'PagerDuty', 'observability', { a: ['pagerduty', 'pager duty'] }],
  ['opsgenie', 'Opsgenie', 'observability', { a: ['opsgenie'] }],
  ['sentry', 'Sentry', 'observability', { a: ['sentry.io'], w: [lw('Sentry')], req: ['datadog', 'new-relic', 'grafana', 'prometheus', LANGS, '@frameworks'] }],
  ['honeycomb', 'Honeycomb', 'observability', { a: ['honeycomb.io'] }],
  ['nagios', 'Nagios', 'observability', { a: ['nagios'] }],
  ['zabbix', 'Zabbix', 'observability', { a: ['zabbix'] }],
  ['kibana', 'Kibana', 'observability', { a: ['kibana', 'logstash'], also: ['elasticsearch'] }],
  ['solarwinds', 'SolarWinds', 'observability', { a: ['solarwinds'] }],

  // ---- security & identity
  ['crowdstrike', 'CrowdStrike', 'security', { a: ['crowdstrike', 'falcon insight'] }],
  ['sentinelone', 'SentinelOne', 'security', { a: ['sentinelone', 'sentinel one'] }],
  ['palo-alto-networks', 'Palo Alto Networks', 'security', { a: ['palo alto networks', 'palo alto firewalls', 'palo alto firewall', 'prisma cloud', 'prisma access', 'cortex xdr', 'cortex xsoar', 'pan-os'] }],
  ['fortinet', 'Fortinet', 'security', { a: ['fortinet', 'fortigate', 'fortianalyzer', 'fortimanager'] }],
  ['okta', 'Okta', 'security', { a: ['okta'] }],
  ['auth0', 'Auth0', 'security', { a: ['auth0'] }],
  ['microsoft-entra', 'Microsoft Entra ID (Azure AD)', 'security', { a: ['entra id', 'microsoft entra', 'azure ad', 'azure active directory'] }],
  ['zscaler', 'Zscaler', 'security', { a: ['zscaler'] }],
  ['wiz', 'Wiz', 'security', { a: ['wiz.io'], w: [lw('Wiz')], req: ['@security', 'aws', 'azure', 'google-cloud'] }],
  ['snyk', 'Snyk', 'security', { a: ['snyk'] }],
  ['veracode', 'Veracode', 'security', { a: ['veracode'] }],
  ['checkmarx', 'Checkmarx', 'security', { a: ['checkmarx'] }],
  ['sonarqube', 'SonarQube', 'testing', { a: ['sonarqube', 'sonarcloud', 'sonar qube'] }],
  ['tenable', 'Tenable (Nessus)', 'security', { a: ['nessus', 'tenable.io', 'tenable.sc'], cs: ['Tenable'] }],
  ['qualys', 'Qualys', 'security', { a: ['qualys'] }],
  ['rapid7', 'Rapid7', 'security', { a: ['rapid7', 'insightvm', 'insightidr'] }],
  ['microsoft-sentinel', 'Microsoft Sentinel', 'security', { a: ['microsoft sentinel', 'azure sentinel'] }],
  ['microsoft-defender', 'Microsoft Defender', 'security', { a: ['microsoft defender', 'defender for endpoint', 'defender atp', 'microsoft 365 defender'] }],
  ['cyberark', 'CyberArk', 'security', { a: ['cyberark'] }],
  ['sailpoint', 'SailPoint', 'security', { a: ['sailpoint'] }],
  ['ping-identity', 'Ping Identity', 'security', { a: ['ping identity', 'pingfederate', 'pingone'] }],
  ['duo-security', 'Duo Security', 'security', { a: ['duo security', 'cisco duo', 'duo mfa'] }],
  ['proofpoint', 'Proofpoint', 'security', { a: ['proofpoint'] }],
  ['mimecast', 'Mimecast', 'security', { a: ['mimecast'] }],
  ['burp-suite', 'Burp Suite', 'security', { a: ['burp suite', 'burpsuite'] }],
  ['metasploit', 'Metasploit', 'security', { a: ['metasploit'] }],
  ['wireshark', 'Wireshark', 'security', { a: ['wireshark'] }],
  ['kali-linux', 'Kali Linux', 'security', { a: ['kali linux'] }],
  ['darktrace', 'Darktrace', 'security', { a: ['darktrace'] }],
  ['carbon-black', 'VMware Carbon Black', 'security', { a: ['vmware carbon black', 'carbon black edr', 'carbon black cloud', 'carbonblack'] }],
  ['onetrust', 'OneTrust', 'security', { a: ['onetrust'] }],
  ['vanta', 'Vanta', 'security', { w: [lw('Vanta')], req: ['drata', '@security'] }],
  ['drata', 'Drata', 'security', { a: ['drata'] }],
  ['knowbe4', 'KnowBe4', 'security', { a: ['knowbe4'] }],
  ['imperva', 'Imperva', 'security', { a: ['imperva'] }],
  ['keycloak', 'Keycloak', 'security', { a: ['keycloak'] }],

  // ---- programming languages
  ['python', 'Python', 'languages', { a: ['python', 'python3', 'cpython'], npre: /(?:ball|burmese|reticulated|royal|monty)\s+$/i }],
  ['java', 'Java', 'languages', { a: ['java', 'java ee', 'jakarta ee', 'j2ee', 'jvm'], npost: /^\s+(?:island|sea|coffee)\b/i }],
  ['javascript', 'JavaScript', 'languages', { a: ['javascript', 'java script', 'ecmascript', 'es6', 'vanilla js'] }],
  ['typescript', 'TypeScript', 'languages', { a: ['typescript', 'type script'] }],
  ['cpp', 'C++', 'languages', { a: ['c++', 'cpp', 'c++11', 'c++14', 'c++17', 'c++20', 'c++23', 'modern c++'] }],
  ['c', 'C', 'languages', { a: ['c programming', 'c language', 'ansi c', 'embedded c', 'c99'], cs: [{ w: 'C/C++', with: ['cpp'] }], w: [lw('C', { nboth: [/\(\s*$/, /^\s*\)/], npre: /\b[A-Z]\s*[,/]\s*$/, npost: /^\.\s+[A-Z]/ })], req: [LANGS, '@embedded_hardware', 'linux'] }],
  ['csharp', 'C#', 'languages', { a: ['c#', 'c-sharp', 'csharp', 'c sharp'] }],
  ['dotnet', '.NET', 'frameworks', { a: ['.net', '.net core', '.net framework', 'asp.net', 'asp.net core', 'dotnet', 'vb.net', 'entity framework', 'ef core', 'blazor'] }],
  ['go', 'Go (Golang)', 'languages', { a: ['golang', 'go programming', 'go language', 'go lang'], w: [lw('Go', { npost: /^\s*(?:,\s*)?(?:to|live|-to|getter|green|beyond|ahead|fast|far)\b|^\s*\/\s*No\b/i })], req: [LANGS, 'kubernetes', 'docker', 'grpc', '@cloud'] }],
  ['rust', 'Rust', 'languages', { a: ['rustlang', 'rust programming', 'rust language'], w: [lw('Rust')], req: [LANGS, '@embedded_hardware', 'webassembly'] }],
  ['kotlin', 'Kotlin', 'languages', { a: ['kotlin'] }],
  ['swift', 'Swift', 'languages', { a: ['swift programming', 'swift language', 'swiftui', 'swift ui', 'swift/objective-c', 'swift 5'], w: [lw('Swift')], req: ['ios', 'objective-c', 'kotlin', LANGS, '@mobile'] }],
  ['objective-c', 'Objective-C', 'languages', { a: ['objective-c', 'objective c', 'objc', 'obj-c'] }],
  ['ruby', 'Ruby', 'languages', { a: ['ruby programming', 'ruby/rails'], w: [{ w: 'Ruby', npost: BEFORE_NAME, npre: AFTER_NAME }], req: [LANGS, 'rails', 'postgresql', 'mysql', '@frameworks'] }],
  ['rails', 'Ruby on Rails', 'frameworks', { a: ['ruby on rails', 'rubyonrails'], w: [lw('Rails')], req: ['ruby'], also: ['ruby'] }],
  ['php', 'PHP', 'languages', { a: ['php', 'php8', 'php7'] }],
  ['scala', 'Scala', 'languages', { a: ['scala'], npre: /\bla\s+$/i }],
  ['elixir', 'Elixir', 'languages', { a: ['elixir/phoenix', 'elixir and phoenix'], w: [lw('Elixir')], req: [LANGS, 'erlang', 'postgresql'] }],
  ['erlang', 'Erlang', 'languages', { a: ['erlang'] }],
  ['haskell', 'Haskell', 'languages', { cs: [{ w: 'Haskell', npre: AFTER_NAME }] }],
  ['clojure', 'Clojure', 'languages', { a: ['clojure', 'clojurescript'] }],
  ['fsharp', 'F#', 'languages', { a: ['f#', 'fsharp'] }],
  ['ocaml', 'OCaml', 'languages', { a: ['ocaml'] }],
  ['perl', 'Perl', 'languages', { cs: ['Perl', 'PERL'] }],
  ['lua', 'Lua', 'languages', { w: [lw('Lua')], req: [LANGS] }],
  ['r', 'R', 'languages', { a: ['r programming', 'r language', 'rstudio', 'r studio', 'r shiny', 'tidyverse', 'ggplot2', 'dplyr', 'r markdown', 'rmarkdown'], w: [lw('R', { npre: /(?:[A-Z]\.\s*|&\s*|\b[A-Z]\s*[,/]\s*)$/, npost: /^(?:&|\.[A-Z]|\.\s+[A-Z])/, nboth: [/\(\s*$/, /^\s*\)/] })], req: ['python', 'sql', 'sas', 'stata', 'spss', 'matlab', 'julia', 'scala', 'java', 'excel', 'tableau', 'power-bi'] }],
  ['matlab', 'MATLAB', 'languages', { a: ['matlab'] }],
  ['julia', 'Julia', 'languages', { a: ['julia language', 'julialang', 'julia programming'], w: [lw('Julia', { npost: BEFORE_NAME })], req: ['python', 'r', 'matlab', 'cpp', 'c', 'fortran'] }],
  ['dart', 'Dart', 'languages', { a: ['dart/flutter', 'dart and flutter'], w: [lw('Dart')], req: ['flutter', LANGS] }],
  ['sql', 'SQL', 'languages', { cs: ['SQL', 'Sql'], a: ['sql queries', 'sql query'] }],
  ['bash', 'Bash / shell scripting', 'languages', { a: ['bash scripting', 'shell scripting', 'bash/shell', 'shell/bash', 'zsh'], w: [lw('Bash'), lw('bash')], req: [LANGS, 'linux'] }],
  ['powershell', 'PowerShell', 'languages', { a: ['powershell', 'power shell'] }],
  ['cobol', 'COBOL', 'languages', { a: ['cobol'] }],
  ['fortran', 'Fortran', 'languages', { a: ['fortran'] }],
  ['vba', 'VBA', 'languages', { a: ['vba', 'visual basic for applications', 'excel macros'] }],
  ['solidity', 'Solidity', 'languages', { cs: ['Solidity'] }],
  ['groovy', 'Groovy', 'languages', { w: [lw('Groovy')], req: [LANGS, 'jenkins', 'gradle'] }],
  ['apex', 'Salesforce Apex', 'languages', { a: ['apex code', 'apex triggers', 'apex classes', 'salesforce apex', 'apex/visualforce', 'visualforce', 'lightning web components', 'lwc', 'soql'], w: [lw('Apex')], req: ['salesforce', 'javascript'], also: ['salesforce'] }],
  ['abap', 'ABAP', 'languages', { a: ['abap', 'sap abap'], also: ['sap'] }],
  ['webassembly', 'WebAssembly', 'languages', { a: ['webassembly', 'wasm'] }],
  ['zig', 'Zig', 'languages', { a: ['ziglang'] }],

  // ---- frameworks & libraries
  ['react', 'React', 'frameworks', { a: ['react.js', 'reactjs', 'react js', 'react hooks', 'react/redux', 'react/typescript'], cs: [{ w: 'React', npost: /^\s+(?:to|quickly|swiftly|appropriately|calmly|immediately|accordingly|fast|positively|well)\b/i }] }],
  ['react-native', 'React Native', 'mobile', { a: ['react native', 'react-native'] }],
  ['angular', 'Angular', 'frameworks', { a: ['angularjs', 'angular.js', 'angular js'], cs: ['Angular'] }],
  ['vue', 'Vue.js', 'frameworks', { a: ['vue.js', 'vuejs', 'vue js', 'vue 3', 'vue3', 'vuex', 'pinia'], w: [lw('Vue')], req: ['javascript', 'typescript', 'react', 'angular', 'nuxt'] }],
  ['nextjs', 'Next.js', 'frameworks', { a: ['next.js', 'nextjs', 'next js'] }],
  ['nuxt', 'Nuxt', 'frameworks', { a: ['nuxt.js', 'nuxtjs', 'nuxt 3'], cs: ['Nuxt'] }],
  ['svelte', 'Svelte', 'frameworks', { a: ['svelte', 'sveltekit'] }],
  ['nodejs', 'Node.js', 'frameworks', { a: ['node.js', 'nodejs', 'node js'], cs: [lw('Node')] }],
  ['express', 'Express.js', 'frameworks', { a: ['express.js', 'expressjs'] }],
  ['nestjs', 'NestJS', 'frameworks', { a: ['nestjs', 'nest.js'] }],
  ['django', 'Django', 'frameworks', { a: ['django', 'django rest framework'] }],
  ['flask', 'Flask', 'frameworks', { w: [lw('Flask')], req: ['python', 'django', 'fastapi'] }],
  ['fastapi', 'FastAPI', 'frameworks', { a: ['fastapi', 'fast api'] }],
  ['spring', 'Spring Boot', 'frameworks', { a: ['spring boot', 'springboot', 'spring framework', 'spring mvc', 'spring cloud', 'spring data', 'spring security', 'spring batch'], w: [lw('Spring')], req: ['java', 'kotlin', 'hibernate'] }],
  ['hibernate', 'Hibernate', 'frameworks', { a: ['hibernate orm', 'jpa/hibernate', 'hibernate/jpa'], w: [lw('Hibernate')], req: ['java', 'spring'] }],
  ['laravel', 'Laravel', 'frameworks', { a: ['laravel'] }],
  ['symfony', 'Symfony', 'frameworks', { a: ['symfony'] }],
  ['jquery', 'jQuery', 'frameworks', { a: ['jquery'] }],
  ['redux', 'Redux', 'frameworks', { a: ['redux', 'redux toolkit'] }],
  ['graphql', 'GraphQL', 'frameworks', { a: ['graphql', 'apollo graphql', 'apollo client', 'apollo server'] }],
  ['grpc', 'gRPC', 'frameworks', { a: ['grpc', 'protobuf', 'protocol buffers'] }],
  ['tailwind', 'Tailwind CSS', 'frameworks', { a: ['tailwind css', 'tailwindcss'], w: [lw('Tailwind')], req: ['javascript', 'typescript', 'react', 'vue', 'nextjs', 'css'] }],
  ['bootstrap', 'Bootstrap', 'frameworks', { w: [lw('Bootstrap')], req: ['javascript', 'jquery', 'css', 'react', 'angular'] }],
  ['css', 'CSS / Sass', 'frameworks', { a: ['css3', 'scss', 'html/css', 'html5/css3', 'html & css', 'html and css', 'css/html'], w: [lw('CSS'), lw('Sass')], req: ['javascript', 'typescript', 'react', 'angular', 'vue', 'jquery', 'php', 'wordpress', 'figma'] }],
  ['webpack', 'Webpack', 'frameworks', { a: ['webpack'] }],
  ['vite', 'Vite', 'frameworks', { w: [lw('Vite')], req: ['javascript', 'typescript', 'react', 'vue'] }],
  ['storybook', 'Storybook', 'frameworks', { w: [lw('Storybook')], req: ['javascript', 'typescript', 'react', 'vue', 'angular'] }],
  ['unity', 'Unity', 'design_cad', { a: ['unity3d', 'unity 3d', 'unity engine', 'unity game engine'], w: [lw('Unity')], req: ['csharp', 'unreal-engine', 'cpp', 'blender', 'maya'] }],
  ['unreal-engine', 'Unreal Engine', 'design_cad', { a: ['unreal engine', 'ue4', 'ue5', 'unreal engine 5'], w: [lw('Unreal')], req: ['cpp', 'unity', 'blender', 'maya'] }],
  ['three-js', 'Three.js', 'frameworks', { a: ['three.js', 'threejs'] }],
  ['d3', 'D3.js', 'frameworks', { a: ['d3.js', 'd3js'] }],
  ['electron', 'Electron', 'frameworks', { a: ['electron.js', 'electronjs'], w: [lw('Electron')], req: ['javascript', 'typescript', 'react', 'nodejs'] }],
  ['qt', 'Qt', 'frameworks', { a: ['qt framework', 'qt/qml', 'qml', 'pyqt'], w: [lw('Qt')], req: ['cpp', 'python'] }],

  // ---- mobile
  ['ios', 'iOS', 'mobile', { cs: ['iOS', 'IOS SDK'], a: ['uikit', 'xcode'] }],
  ['android', 'Android', 'mobile', { a: ['android', 'android sdk', 'android studio', 'jetpack compose'] }],
  ['flutter', 'Flutter', 'mobile', { a: ['flutterflow'], w: [lw('Flutter')], req: ['dart', 'kotlin', 'swift', 'react-native', 'ios', 'android', 'firebase'] }],
  ['xamarin', 'Xamarin', 'mobile', { a: ['xamarin', '.net maui', 'dotnet maui'] }],
  ['ionic', 'Ionic', 'mobile', { a: ['ionic framework'], w: [lw('Ionic')], req: ['angular', 'javascript', 'typescript', 'react', 'capacitor'] }],
  ['capacitor', 'Capacitor', 'mobile', { a: ['capacitorjs'] }],
  ['expo', 'Expo', 'mobile', { a: ['expo go', 'expo sdk'] }],

  // ---- testing & QA
  ['selenium', 'Selenium', 'testing', { a: ['selenium webdriver', 'selenium grid'], w: [lw('Selenium')], req: [LANGS, '@testing'] }],
  ['cypress', 'Cypress', 'testing', { a: ['cypress.io'], w: [lw('Cypress')], req: ['javascript', 'typescript', '@testing'] }],
  ['playwright', 'Playwright', 'testing', { w: [lw('Playwright')], req: ['javascript', 'typescript', 'python', '@testing'] }],
  ['jest', 'Jest', 'testing', { w: [lw('Jest')], req: ['javascript', 'typescript', 'react', '@testing'] }],
  ['pytest', 'pytest', 'testing', { a: ['pytest'] }],
  ['junit', 'JUnit / TestNG', 'testing', { a: ['junit', 'testng', 'mockito'] }],
  ['appium', 'Appium', 'testing', { a: ['appium'] }],
  ['postman', 'Postman', 'testing', { w: [lw('Postman')], req: [LANGS, '@testing', 'graphql'] }],
  ['jmeter', 'JMeter / LoadRunner / Gatling', 'testing', { a: ['jmeter', 'apache jmeter', 'loadrunner', 'gatling'] }],
  ['cucumber', 'Cucumber', 'testing', { a: ['cucumber bdd', 'gherkin'], w: [lw('Cucumber')], req: ['@testing', LANGS] }],
  ['browserstack', 'BrowserStack', 'testing', { a: ['browserstack', 'sauce labs', 'saucelabs'] }],

  // ---- CRM & sales tools
  ['salesforce', 'Salesforce', 'crm_sales', { a: ['salesforce', 'salesforce.com', 'sfdc', 'sales cloud', 'service cloud', 'salesforce crm', 'salesforce administrator', 'salesforce admin', 'experience cloud'] }],
  ['hubspot', 'HubSpot', 'crm_sales', { a: ['hubspot', 'hub spot'] }],
  ['dynamics-365', 'Microsoft Dynamics 365', 'crm_sales', { a: ['dynamics 365', 'dynamics365', 'd365', 'microsoft dynamics', 'ms dynamics', 'dynamics crm', 'dynamics nav', 'dynamics ax', 'business central', 'dynamics gp', 'navision'] }],
  ['zoho', 'Zoho', 'crm_sales', { a: ['zoho', 'zoho crm', 'zoho books'] }],
  ['pipedrive', 'Pipedrive', 'crm_sales', { a: ['pipedrive'] }],
  ['close-crm', 'Close CRM', 'crm_sales', { a: ['close.com', 'close crm', 'close.io'] }],
  ['salesloft', 'Salesloft', 'crm_sales', { a: ['salesloft'] }],
  ['outreach', 'Outreach', 'crm_sales', { a: ['outreach.io'], w: [lw('Outreach')], req: ['salesloft', 'salesforce', 'hubspot', 'gong', 'zoominfo', 'apollo-io'] }],
  ['gong', 'Gong', 'crm_sales', { a: ['gong.io'], w: [lw('Gong')], req: ['salesforce', 'hubspot', 'outreach', 'salesloft', 'zoominfo', 'clari'] }],
  ['clari', 'Clari', 'crm_sales', { w: [lw('Clari')], req: ['salesforce', 'hubspot', 'gong', 'outreach', 'salesloft'] }],
  ['zoominfo', 'ZoomInfo', 'crm_sales', { a: ['zoominfo', 'zoom info', 'discoverorg'] }],
  ['apollo-io', 'Apollo.io', 'crm_sales', { a: ['apollo.io'] }],
  ['sales-navigator', 'LinkedIn Sales Navigator', 'crm_sales', { a: ['sales navigator', 'linkedin sales navigator'] }],
  ['6sense', '6sense', 'crm_sales', { a: ['6sense'] }],
  ['demandbase', 'Demandbase', 'crm_sales', { a: ['demandbase'] }],
  ['clearbit', 'Clearbit', 'crm_sales', { a: ['clearbit'] }],
  ['seismic', 'Seismic', 'crm_sales', { w: [lw('Seismic')], req: ['salesforce', 'highspot', 'gong', 'outreach', 'salesloft', 'hubspot'] }],
  ['highspot', 'Highspot', 'crm_sales', { a: ['highspot'] }],
  ['docusign', 'DocuSign', 'crm_sales', { a: ['docusign'] }],
  ['pandadoc', 'PandaDoc', 'crm_sales', { a: ['pandadoc'] }],
  ['salesforce-cpq', 'Salesforce CPQ', 'crm_sales', { a: ['salesforce cpq', 'steelbrick'], also: ['salesforce'] }],
  ['veeva', 'Veeva', 'healthcare_it', { a: ['veeva', 'veeva vault', 'veeva crm'] }],

  // ---- marketing automation & adtech
  ['marketo', 'Adobe Marketo', 'marketing', { a: ['marketo'] }],
  ['pardot', 'Salesforce Pardot (Account Engagement)', 'marketing', { a: ['pardot', 'marketing cloud account engagement'] }],
  ['salesforce-marketing-cloud', 'Salesforce Marketing Cloud', 'marketing', { a: ['salesforce marketing cloud', 'sfmc', 'exacttarget', 'ampscript'], also: ['salesforce'] }],
  ['eloqua', 'Oracle Eloqua', 'marketing', { a: ['eloqua'] }],
  ['mailchimp', 'Mailchimp', 'marketing', { a: ['mailchimp'] }],
  ['braze', 'Braze', 'marketing', { a: ['braze.com'], w: [lw('Braze')], req: ['@marketing', '@product_analytics', 'segment', 'iterable'] }],
  ['iterable', 'Iterable', 'marketing', { a: ['iterable.com'], w: [lw('Iterable')], req: ['braze', 'klaviyo', 'customer-io', 'marketo', 'hubspot', 'segment', 'salesforce-marketing-cloud'] }],
  ['klaviyo', 'Klaviyo', 'marketing', { a: ['klaviyo'] }],
  ['customer-io', 'Customer.io', 'marketing', { a: ['customer.io'] }],
  ['sendgrid', 'SendGrid', 'marketing', { a: ['sendgrid'] }],
  ['twilio', 'Twilio', 'marketing', { a: ['twilio'] }],
  ['adobe-experience-manager', 'Adobe Experience Manager', 'marketing', { a: ['adobe experience manager', 'aem'] }],
  ['adobe-experience-platform', 'Adobe Experience Platform', 'marketing', { a: ['adobe experience platform', 'adobe experience cloud', 'adobe campaign', 'adobe target', 'adobe journey optimizer', 'adobe real-time cdp'] }],
  ['sitecore', 'Sitecore', 'marketing', { a: ['sitecore'] }],
  ['contentful', 'Contentful', 'marketing', { a: ['contentful'] }],
  ['wordpress', 'WordPress', 'marketing', { a: ['wordpress', 'woocommerce'] }],
  ['drupal', 'Drupal', 'marketing', { a: ['drupal'] }],
  ['webflow', 'Webflow', 'marketing', { a: ['webflow'] }],
  ['google-ads', 'Google Ads', 'marketing', { a: ['google ads', 'google adwords', 'adwords', 'google ad manager', 'dv360', 'display & video 360', 'campaign manager 360'] }],
  ['meta-ads', 'Meta Ads', 'marketing', { a: ['meta ads', 'facebook ads', 'facebook ads manager', 'meta ads manager', 'meta business suite'] }],
  ['linkedin-ads', 'LinkedIn Ads', 'marketing', { a: ['linkedin ads', 'linkedin campaign manager'] }],
  ['the-trade-desk', 'The Trade Desk', 'marketing', { a: ['the trade desk', 'tradedesk'] }],
  ['semrush', 'Semrush', 'marketing', { a: ['semrush', 'sem rush'] }],
  ['ahrefs', 'Ahrefs', 'marketing', { a: ['ahrefs'] }],
  ['moz', 'Moz', 'marketing', { a: ['moz pro'], w: [lw('Moz')], req: ['semrush', 'ahrefs', 'google-analytics', 'screaming-frog'] }],
  ['screaming-frog', 'Screaming Frog', 'marketing', { a: ['screaming frog'] }],
  ['hootsuite', 'Hootsuite', 'marketing', { a: ['hootsuite'] }],
  ['sprout-social', 'Sprout Social', 'marketing', { a: ['sprout social', 'sproutsocial'] }],
  ['sprinklr', 'Sprinklr', 'marketing', { a: ['sprinklr'] }],
  ['canva', 'Canva', 'design_cad', { cs: ['Canva'] }],
  ['unbounce', 'Unbounce', 'marketing', { a: ['unbounce'] }],
  ['appsflyer', 'AppsFlyer', 'marketing', { a: ['appsflyer'] }],
  ['qualtrics', 'Qualtrics', 'customer_support', { a: ['qualtrics'] }],
  ['medallia', 'Medallia', 'customer_support', { a: ['medallia'] }],
  ['surveymonkey', 'SurveyMonkey', 'customer_support', { a: ['surveymonkey', 'survey monkey'] }],

  // ---- customer support & CX
  ['zendesk', 'Zendesk', 'customer_support', { a: ['zendesk'] }],
  ['freshdesk', 'Freshworks (Freshdesk)', 'customer_support', { a: ['freshdesk', 'freshworks', 'freshservice', 'freshsales'] }],
  ['intercom', 'Intercom', 'customer_support', { w: [lw('Intercom')], req: ['zendesk', 'salesforce', 'hubspot', 'freshdesk', 'gorgias', 'jira'] }],
  ['servicenow', 'ServiceNow', 'it_infrastructure', { a: ['servicenow', 'service now', 'servicenow itsm'] }],
  ['gorgias', 'Gorgias', 'customer_support', { a: ['gorgias'] }],
  ['kustomer', 'Kustomer', 'customer_support', { a: ['kustomer'] }],
  ['gainsight', 'Gainsight', 'customer_support', { a: ['gainsight'] }],
  ['totango', 'Totango', 'customer_support', { a: ['totango'] }],
  ['genesys', 'Genesys', 'customer_support', { a: ['genesys', 'genesys cloud'] }],
  ['five9', 'Five9', 'customer_support', { a: ['five9'] }],
  ['nice-cxone', 'NICE CXone', 'customer_support', { a: ['nice cxone', 'nice incontact', 'incontact'] }],
  ['aircall', 'Aircall', 'customer_support', { a: ['aircall'] }],
  ['talkdesk', 'Talkdesk', 'customer_support', { a: ['talkdesk'] }],

  // ---- e-commerce & payments
  ['shopify', 'Shopify', 'ecommerce_payments', { a: ['shopify', 'shopify plus'] }],
  ['magento', 'Adobe Commerce (Magento)', 'ecommerce_payments', { a: ['magento', 'adobe commerce'] }],
  ['bigcommerce', 'BigCommerce', 'ecommerce_payments', { a: ['bigcommerce'] }],
  ['salesforce-commerce-cloud', 'Salesforce Commerce Cloud', 'ecommerce_payments', { a: ['salesforce commerce cloud', 'sfcc', 'demandware'], also: ['salesforce'] }],
  ['commercetools', 'commercetools', 'ecommerce_payments', { a: ['commercetools'] }],
  ['stripe', 'Stripe', 'ecommerce_payments', { cs: [{ w: 'Stripe', npre: /(?:pin|racing|white|red|blue)\s*$/i }], a: ['stripe api', 'stripe connect', 'stripe billing'] }],
  ['adyen', 'Adyen', 'ecommerce_payments', { a: ['adyen'] }],
  ['braintree', 'Braintree', 'ecommerce_payments', { cs: ['Braintree'] }],
  ['paypal', 'PayPal', 'ecommerce_payments', { a: ['paypal'] }],
  ['plaid', 'Plaid', 'ecommerce_payments', { a: ['plaid api'], w: [lw('Plaid')], req: ['stripe', 'adyen', 'marqeta', 'paypal', LANGS] }],
  ['marqeta', 'Marqeta', 'ecommerce_payments', { a: ['marqeta'] }],
  ['checkout-com', 'Checkout.com', 'ecommerce_payments', { a: ['checkout.com'] }],
  ['chargebee', 'Chargebee', 'ecommerce_payments', { a: ['chargebee'] }],
  ['zuora', 'Zuora', 'ecommerce_payments', { a: ['zuora'] }],
  ['recurly', 'Recurly', 'ecommerce_payments', { a: ['recurly'] }],
  ['avalara', 'Avalara', 'erp_finance', { a: ['avalara'] }],

  // ---- ERP & finance
  ['sap', 'SAP', 'erp_finance', { cs: [{ w: 'SAP', npost: /^\s*(?:-|–)?\s*(?:Arena|Center|Garden)\b/ }], a: ['sap erp', 'sap ecc', 'sap fico', 'sap fi/co', 'sap mm', 'sap sd', 'sap bw', 'sap basis'] }],
  ['sap-s4hana', 'SAP S/4HANA', 'erp_finance', { a: ['s/4hana', 's4hana', 's/4 hana', 's4 hana', 'sap s/4'], also: ['sap'] }],
  ['oracle-netsuite', 'Oracle NetSuite', 'erp_finance', { a: ['netsuite', 'net suite', 'suitescript'] }],
  ['oracle-erp', 'Oracle ERP / Fusion', 'erp_finance', { a: ['oracle erp', 'oracle fusion', 'oracle e-business suite', 'oracle ebs', 'oracle financials', 'oracle cloud erp', 'jd edwards', 'jde', 'peoplesoft', 'oracle hcm', 'hyperion', 'oracle epm'] }],
  ['sage', 'Sage', 'erp_finance', { a: ['sage intacct', 'sage x3', 'sage 50', 'sage 100', 'sage 200', 'sage 300', 'sage accounting', 'sage people'] }],
  ['quickbooks', 'QuickBooks', 'erp_finance', { a: ['quickbooks', 'quick books', 'qbo'] }],
  ['xero', 'Xero', 'erp_finance', { cs: ['Xero', 'XERO'] }],
  ['infor', 'Infor', 'erp_finance', { a: ['infor m3', 'infor ln', 'infor cloudsuite', 'infor syteline', 'infor erp'], w: [lw('Infor')], req: ['@erp_finance'] }],
  ['epicor', 'Epicor', 'erp_finance', { a: ['epicor'] }],
  ['acumatica', 'Acumatica', 'erp_finance', { a: ['acumatica'] }],
  ['odoo', 'Odoo', 'erp_finance', { a: ['odoo'] }],
  ['ifs', 'IFS Cloud', 'erp_finance', { a: ['ifs cloud', 'ifs applications'] }],
  ['coupa', 'Coupa', 'erp_finance', { a: ['coupa'] }],
  ['ariba', 'SAP Ariba', 'erp_finance', { a: ['ariba'], also: ['sap'] }],
  ['concur', 'SAP Concur', 'erp_finance', { cs: ['Concur'], also: [] }],
  ['expensify', 'Expensify', 'erp_finance', { a: ['expensify'] }],
  ['bill-com', 'BILL (Bill.com)', 'erp_finance', { a: ['bill.com'] }],
  ['blackline', 'BlackLine', 'erp_finance', { cs: ['BlackLine', 'Blackline'] }],
  ['anaplan', 'Anaplan', 'erp_finance', { a: ['anaplan'] }],
  ['adaptive-planning', 'Workday Adaptive Planning', 'erp_finance', { a: ['adaptive insights', 'adaptive planning'] }],
  ['kyriba', 'Kyriba', 'erp_finance', { a: ['kyriba'] }],
  ['oracle-hyperion', 'Oracle Hyperion', 'erp_finance', { a: ['hyperion essbase', 'essbase', 'oracle pbcs'] }],
  ['onestream', 'OneStream', 'erp_finance', { a: ['onestream'] }],
  ['bloomberg-terminal', 'Bloomberg Terminal', 'erp_finance', { a: ['bloomberg terminal', 'bloomberg professional'] }],
  ['factset', 'FactSet', 'erp_finance', { a: ['factset'] }],
  ['capital-iq', 'S&P Capital IQ', 'erp_finance', { a: ['capital iq', 'capiq'] }],
  ['pitchbook', 'PitchBook', 'erp_finance', { a: ['pitchbook'] }],

  // ---- HR & payroll (applicant tracking systems are left out: the index is built from them)
  ['workday-hcm', 'Workday HCM / Financials', 'hr_payroll', { a: ['workday hcm', 'workday financials', 'workday studio', 'workday integrations', 'workday reporting', 'workday prism', 'workday payroll', 'workday extend', 'workday hris', 'workday security', 'workday adaptive'], cs: [{ w: 'Workday', pre: /(?:\b(?:in|with|using|of|on)|[,;/(:])\s*$/, post: /^\s*(?:[,;/)]|\s(?:and|or)\s|HCM|HRIS|Financials|Studio|system|platform|implementation|configuration|integrations?|reports?|reporting|experience|tenant|modules?)/ }] }],
  ['successfactors', 'SAP SuccessFactors', 'hr_payroll', { a: ['successfactors', 'sap successfactors'], also: ['sap'] }],
  ['adp', 'ADP', 'hr_payroll', { a: ['adp workforce now', 'adp vantage', 'adp payroll', 'adp globalview', 'adp celergo'], cs: [lw('ADP')] }],
  ['ukg', 'UKG (Kronos)', 'hr_payroll', { a: ['ukg', 'ultipro', 'ukg pro', 'kronos workforce', 'ukg dimensions'], cs: ['Kronos'] }],
  ['bamboohr', 'BambooHR', 'hr_payroll', { a: ['bamboohr', 'bamboo hr'] }],
  ['rippling', 'Rippling', 'hr_payroll', { cs: ['Rippling'] }],
  ['gusto', 'Gusto', 'hr_payroll', { w: [lw('Gusto')], req: ['@hr_payroll', 'quickbooks', 'xero'] }],
  ['deel', 'Deel', 'hr_payroll', { a: ['deel.com'], w: [lw('Deel')], req: ['@hr_payroll', 'remote-com'] }],
  ['remote-com', 'Remote.com', 'hr_payroll', { a: ['remote.com'] }],
  ['paylocity', 'Paylocity', 'hr_payroll', { a: ['paylocity'] }],
  ['paycom', 'Paycom', 'hr_payroll', { a: ['paycom'] }],
  ['paychex', 'Paychex', 'hr_payroll', { a: ['paychex'] }],
  ['dayforce', 'Dayforce (Ceridian)', 'hr_payroll', { a: ['dayforce', 'ceridian'] }],
  ['hibob', 'HiBob', 'hr_payroll', { a: ['hibob'] }],
  ['personio-hr', 'Personio (HRIS)', 'hr_payroll', { a: ['personio hr', 'personio hris'] }],
  ['lattice', 'Lattice', 'hr_payroll', { a: ['lattice hr', 'lattice performance'] }],
  ['culture-amp', 'Culture Amp', 'hr_payroll', { a: ['culture amp', 'cultureamp'] }],
  ['icims', 'iCIMS', 'hr_payroll', { a: ['icims'] }],
  ['cornerstone', 'Cornerstone OnDemand', 'hr_payroll', { a: ['cornerstone ondemand', 'cornerstone csod', 'csod'] }],
  ['docebo', 'Docebo', 'hr_payroll', { a: ['docebo'] }],

  // ---- collaboration & productivity
  ['jira', 'Jira', 'collaboration', { a: ['jira', 'jira software', 'jira service management', 'jira align'] }],
  ['confluence', 'Confluence', 'collaboration', { cs: ['Confluence'], npost: /^\s+of\b/ }],
  ['slack', 'Slack', 'collaboration', { cs: [{ w: 'Slack', npost: /^\s+(?:time|periods?|season|off)\b/i }] }],
  ['microsoft-teams', 'Microsoft Teams', 'collaboration', { a: ['microsoft teams', 'ms teams'] }],
  ['microsoft-365', 'Microsoft 365 / Office', 'collaboration', { a: ['microsoft 365', 'office 365', 'o365', 'm365', 'microsoft office', 'ms office', 'microsoft office suite', 'sharepoint', 'onedrive', 'power apps', 'powerapps', 'power platform', 'microsoft power platform'] }],
  ['power-automate', 'Microsoft Power Automate', 'automation', { a: ['power automate', 'microsoft flow'] }],
  ['google-workspace', 'Google Workspace', 'collaboration', { a: ['google workspace', 'g suite', 'gsuite', 'google suite', 'google apps script'] }],
  ['notion', 'Notion', 'collaboration', { a: ['notion.so', 'notion ai'], w: [lw('Notion')], req: ['@collaboration', 'figma'] }],
  ['asana', 'Asana', 'collaboration', { w: [lw('Asana')], req: ['@collaboration'] }],
  ['monday-com', 'monday.com', 'collaboration', { a: ['monday.com'] }],
  ['trello', 'Trello', 'collaboration', { a: ['trello'] }],
  ['smartsheet', 'Smartsheet', 'collaboration', { a: ['smartsheet'] }],
  ['airtable', 'Airtable', 'collaboration', { a: ['airtable'] }],
  ['clickup', 'ClickUp', 'collaboration', { a: ['clickup'] }],
  ['miro', 'Miro', 'collaboration', { cs: ['Miro'] , npost: BEFORE_NAME, npre: AFTER_NAME }],
  ['loom', 'Loom', 'collaboration', { w: [lw('Loom')], req: ['@collaboration'] }],
  ['zoom', 'Zoom', 'collaboration', { a: ['zoom video', 'zoom meetings', 'zoom rooms'] }],
  ['linear', 'Linear', 'collaboration', { a: ['linear.app'] }],
  ['microsoft-project', 'Microsoft Project', 'collaboration', { a: ['microsoft project', 'ms project'] }],

  // ---- design, 3D & CAD
  ['figma', 'Figma', 'design_cad', { a: ['figma', 'figjam'] }],
  ['sketch', 'Sketch', 'design_cad', { a: ['sketch app'], w: [lw('Sketch')], req: ['figma', 'adobe-xd', 'invision', 'adobe-creative-cloud'] }],
  ['adobe-xd', 'Adobe XD', 'design_cad', { a: ['adobe xd'] }],
  ['invision', 'InVision', 'design_cad', { cs: ['InVision'] }],
  ['adobe-creative-cloud', 'Adobe Creative Cloud', 'design_cad', { a: ['adobe creative cloud', 'adobe creative suite', 'photoshop', 'adobe illustrator', 'indesign', 'after effects', 'premiere pro', 'adobe premiere', 'lightroom', 'adobe acrobat'], w: [lw('Illustrator')], req: ['adobe-creative-cloud', 'figma', 'sketch'] }],
  ['blender', 'Blender', 'design_cad', { w: [lw('Blender')], req: ['maya', '3ds-max', 'unity', 'unreal-engine', 'cinema-4d', 'zbrush', 'adobe-creative-cloud'] }],
  ['maya', 'Autodesk Maya', 'design_cad', { a: ['autodesk maya'], w: [lw('Maya', { npost: BEFORE_NAME })], req: ['blender', '3ds-max', 'unity', 'unreal-engine', 'cinema-4d', 'zbrush', 'houdini'] }],
  ['3ds-max', 'Autodesk 3ds Max', 'design_cad', { a: ['3ds max', '3dsmax', '3d studio max'] }],
  ['cinema-4d', 'Cinema 4D', 'design_cad', { a: ['cinema 4d', 'cinema4d', 'c4d'] }],
  ['zbrush', 'ZBrush', 'design_cad', { a: ['zbrush'] }],
  ['houdini', 'Houdini', 'design_cad', { a: ['sidefx houdini'], w: [lw('Houdini')], req: ['maya', 'blender', 'nuke', 'unreal-engine'] }],
  ['nuke', 'Nuke', 'design_cad', { a: ['foundry nuke'], w: [lw('Nuke')], req: ['maya', 'houdini', 'adobe-creative-cloud', 'blender'] }],
  ['autocad', 'AutoCAD', 'design_cad', { a: ['autocad', 'auto cad'] }],
  ['revit', 'Revit', 'design_cad', { a: ['revit', 'autodesk revit'] }],
  ['solidworks', 'SolidWorks', 'design_cad', { a: ['solidworks', 'solid works'] }],
  ['catia', 'CATIA', 'design_cad', { a: ['catia', '3dexperience'] }],
  ['siemens-nx', 'Siemens NX', 'design_cad', { a: ['siemens nx', 'unigraphics', 'teamcenter'] }],
  ['creo', 'PTC Creo', 'design_cad', { a: ['ptc creo', 'creo parametric', 'windchill'] }],
  ['fusion-360', 'Autodesk Fusion 360', 'design_cad', { a: ['fusion 360', 'fusion360'] }],
  ['inventor', 'Autodesk Inventor', 'design_cad', { a: ['autodesk inventor'] }],
  ['rhino', 'Rhino 3D', 'design_cad', { a: ['rhino 3d', 'rhinoceros 3d', 'rhino3d', 'grasshopper 3d'] }],
  ['sketchup', 'SketchUp', 'design_cad', { a: ['sketchup'] }],
  ['ansys', 'Ansys', 'design_cad', { a: ['ansys', 'ansys fluent', 'ansys mechanical'] }],
  ['abaqus', 'Abaqus', 'design_cad', { a: ['abaqus'] }],
  ['arcgis', 'ArcGIS (Esri)', 'design_cad', { a: ['arcgis', 'esri arcgis', 'arcmap', 'arcgis pro'] }],
  ['qgis', 'QGIS', 'design_cad', { a: ['qgis'] }],
  ['bim-360', 'Autodesk BIM 360 / Construction Cloud', 'design_cad', { a: ['bim 360', 'bim360', 'autodesk construction cloud', 'navisworks'] }],
  ['procore', 'Procore', 'design_cad', { a: ['procore'] }],

  // ---- IT infrastructure & ITSM
  ['linux', 'Linux', 'it_infrastructure', { a: ['linux', 'rhel', 'red hat enterprise linux', 'centos', 'debian'], cs: ['Ubuntu'] }],
  ['windows-server', 'Windows Server', 'it_infrastructure', { a: ['windows server', 'win server'] }],
  ['active-directory', 'Active Directory', 'it_infrastructure', { a: ['active directory', 'ldap'] }],
  ['intune', 'Microsoft Intune', 'it_infrastructure', { a: ['intune', 'microsoft endpoint manager', 'sccm', 'mecm'] }],
  ['jamf', 'Jamf', 'it_infrastructure', { a: ['jamf', 'jamf pro'] }],
  ['vmware', 'VMware', 'it_infrastructure', { a: ['vmware', 'vsphere', 'esxi', 'vcenter', 'vmware horizon', 'vsan', 'nsx-t'] }],
  ['hyper-v', 'Microsoft Hyper-V', 'it_infrastructure', { a: ['hyper-v', 'hyperv'] }],
  ['citrix', 'Citrix', 'it_infrastructure', { a: ['citrix', 'xenapp', 'xendesktop'] }],
  ['nutanix', 'Nutanix', 'it_infrastructure', { a: ['nutanix'] }],
  ['netapp', 'NetApp', 'it_infrastructure', { a: ['netapp'] }],
  ['pure-storage', 'Pure Storage', 'it_infrastructure', { a: ['pure storage', 'purestorage'] }],
  ['veeam', 'Veeam', 'it_infrastructure', { a: ['veeam'] }],
  ['commvault', 'Commvault', 'it_infrastructure', { a: ['commvault'] }],
  ['rubrik', 'Rubrik', 'it_infrastructure', { a: ['rubrik'] }],
  ['cisco', 'Cisco networking', 'it_infrastructure', { a: ['cisco ios', 'cisco ise', 'cisco asa', 'cisco catalyst', 'cisco nexus', 'cisco webex', 'webex', 'ccna', 'ccnp', 'ccie', 'cisco meraki', 'meraki', 'cisco umbrella', 'cisco routers', 'cisco switches'] }],
  ['juniper', 'Juniper Networks', 'it_infrastructure', { a: ['juniper networks', 'junos', 'juniper srx', 'juniper mx'] }],
  ['arista', 'Arista Networks', 'it_infrastructure', { a: ['arista networks', 'arista eos', 'arista switches'] }],
  ['f5', 'F5 BIG-IP', 'it_infrastructure', { a: ['f5 big-ip', 'big-ip', 'f5 networks', 'f5 load balancer', 'f5 ltm'] }],
  ['aruba', 'HPE Aruba', 'it_infrastructure', { a: ['aruba networks', 'hpe aruba', 'aruba clearpass'] }],
  ['bmc-remedy', 'BMC Helix (Remedy)', 'it_infrastructure', { a: ['bmc remedy', 'bmc helix', 'remedy itsm'] }],
  ['manageengine', 'ManageEngine', 'it_infrastructure', { a: ['manageengine'] }],
  ['ivanti', 'Ivanti', 'it_infrastructure', { a: ['ivanti'] }],
  ['atlassian', 'Atlassian suite', 'collaboration', { a: ['atlassian'] }],
  ['git', 'Git', 'devops', { cs: ['Git', 'GIT'], npost: /^\s*(?:hub|lab)\b/i }],
  ['mainframe', 'IBM mainframe (z/OS)', 'it_infrastructure', { a: ['z/os', 'zos mainframe', 'ibm mainframe', 'jcl', 'cics', 'ibm z'] }],
  ['as400', 'IBM i (AS/400)', 'it_infrastructure', { a: ['as/400', 'as400', 'iseries', 'ibm i', 'rpgle'] }],

  // ---- low-code, RPA & integration platforms
  ['uipath', 'UiPath', 'automation', { a: ['uipath'] }],
  ['automation-anywhere', 'Automation Anywhere', 'automation', { a: ['automation anywhere'] }],
  ['blue-prism', 'Blue Prism', 'automation', { a: ['blue prism', 'blueprism'] }],
  ['retool', 'Retool', 'automation', { a: ['retool'] }],
  ['outsystems', 'OutSystems', 'automation', { a: ['outsystems'] }],
  ['mendix', 'Mendix', 'automation', { a: ['mendix'] }],
  ['appian', 'Appian', 'automation', { a: ['appian'] }],
  ['pega', 'Pega', 'automation', { a: ['pegasystems', 'pega prpc', 'pega platform', 'pega csa', 'pega cssa'], cs: ['Pega'] }],
  ['camunda', 'Camunda', 'automation', { a: ['camunda'] }],
  ['salesforce-flow', 'Salesforce Flow / Process Builder', 'automation', { a: ['salesforce flow', 'process builder', 'flow builder'], also: ['salesforce'] }],
  ['ibm-websphere', 'IBM WebSphere / MQ', 'automation', { a: ['websphere', 'ibm mq', 'ibm integration bus', 'ibm app connect'] }],
  ['tibco', 'TIBCO', 'automation', { a: ['tibco'] }],
  ['sap-pi-po', 'SAP Integration Suite (PI/PO)', 'automation', { a: ['sap pi/po', 'sap cpi', 'sap integration suite', 'sap btp'], also: ['sap'] }],

  // ---- embedded & hardware design
  ['verilog', 'Verilog / SystemVerilog', 'embedded_hardware', { a: ['verilog', 'systemverilog', 'system verilog'] }],
  ['vhdl', 'VHDL', 'embedded_hardware', { a: ['vhdl'] }],
  ['fpga', 'FPGA', 'embedded_hardware', { a: ['fpga', 'fpgas'] }],
  ['xilinx', 'AMD Xilinx (Vivado)', 'embedded_hardware', { a: ['xilinx', 'vivado', 'zynq'] }],
  ['intel-quartus', 'Intel Quartus', 'embedded_hardware', { a: ['quartus', 'altera'] }],
  ['cadence', 'Cadence EDA', 'embedded_hardware', { a: ['cadence virtuoso', 'cadence allegro', 'cadence orcad', 'orcad', 'cadence innovus', 'cadence spectre', 'cadence genus', 'cadence xcelium', 'virtuoso layout'], w: [lw('Cadence')], req: ['synopsys', 'verilog', 'vhdl', 'mentor-graphics', 'altium', '@embedded_hardware'] }],
  ['synopsys', 'Synopsys EDA', 'embedded_hardware', { a: ['synopsys', 'synopsys vcs', 'synopsys design compiler', 'primetime px'] }],
  ['mentor-graphics', 'Siemens EDA (Mentor)', 'embedded_hardware', { a: ['mentor graphics', 'siemens eda', 'questasim', 'modelsim', 'calibre drc', 'pads layout', 'xpedition'] }],
  ['altium', 'Altium Designer', 'embedded_hardware', { a: ['altium', 'altium designer'] }],
  ['kicad', 'KiCad', 'embedded_hardware', { a: ['kicad'] }],
  ['freertos', 'FreeRTOS', 'embedded_hardware', { a: ['freertos', 'free rtos'] }],
  ['zephyr', 'Zephyr RTOS', 'embedded_hardware', { a: ['zephyr rtos', 'zephyr project'], w: [lw('Zephyr')], req: ['freertos', 'c', 'cpp', 'yocto', 'embedded-linux', 'arm'] }],
  ['yocto', 'Yocto Project', 'embedded_hardware', { a: ['yocto', 'bitbake', 'buildroot'] }],
  ['embedded-linux', 'Embedded Linux', 'embedded_hardware', { a: ['embedded linux', 'linux kernel', 'linux device drivers', 'u-boot'], also: ['linux'] }],
  ['arm', 'Arm Cortex', 'embedded_hardware', { a: ['arm cortex', 'cortex-m', 'cortex-a', 'cortex-r', 'arm architecture', 'aarch64', 'armv8'] }],
  ['stm32', 'STM32', 'embedded_hardware', { a: ['stm32'] }],
  ['arduino', 'Arduino', 'embedded_hardware', { a: ['arduino'] }],
  ['raspberry-pi', 'Raspberry Pi', 'embedded_hardware', { a: ['raspberry pi'] }],
  ['labview', 'LabVIEW', 'embedded_hardware', { a: ['labview', 'teststand'] }],
  ['simulink', 'Simulink', 'embedded_hardware', { a: ['simulink', 'stateflow'] }],
  ['autosar', 'AUTOSAR', 'embedded_hardware', { a: ['autosar'] }],
  ['ros', 'ROS (Robot Operating System)', 'embedded_hardware', { a: ['robot operating system', 'ros2', 'ros 2', 'ros1'], w: [lw('ROS')], req: ['cpp', 'python', 'c', 'linux', 'gazebo', 'opencv'] }],
  ['gazebo', 'Gazebo', 'embedded_hardware', { a: ['gazebo sim', 'gazebo simulator'], w: [lw('Gazebo')], req: ['ros', 'cpp', 'python'] }],
  ['plc', 'PLC programming (Rockwell / Siemens)', 'embedded_hardware', { a: ['plc programming', 'allen-bradley', 'allen bradley', 'rslogix', 'studio 5000', 'tia portal', 'siemens s7', 'codesys', 'ladder logic'] }],
  ['scada', 'SCADA', 'embedded_hardware', { a: ['scada', 'wonderware', 'ignition scada', 'inductive automation'] }],
  ['can-bus', 'CAN bus', 'embedded_hardware', { a: ['can bus', 'canbus', 'can-bus', 'canalyzer', 'vector canoe'] }],

  // ---- healthcare & life-sciences IT
  ['epic-ehr', 'Epic (EHR)', 'healthcare_it', { a: ['epic systems', 'epic ehr', 'epic emr', 'epic certification', 'epic certified', 'epic hyperspace', 'epic clarity', 'epic caboodle', 'epic ambulatory', 'epic inpatient', 'epic beaker', 'epic willow', 'epic resolute', 'epic tapestry', 'epic prelude', 'epic cadence', 'epic cupid', 'epic optime', 'epic radiant', 'epic healthy planet', 'mychart'] }],
  ['cerner', 'Oracle Health (Cerner)', 'healthcare_it', { a: ['cerner', 'oracle health', 'millennium powerchart', 'powerchart'] }],
  ['meditech', 'MEDITECH', 'healthcare_it', { a: ['meditech'] }],
  ['athenahealth', 'athenahealth', 'healthcare_it', { a: ['athenahealth', 'athenaone', 'athena health'] }],
  ['eclinicalworks', 'eClinicalWorks', 'healthcare_it', { a: ['eclinicalworks'] }],
  ['allscripts', 'Veradigm (Allscripts)', 'healthcare_it', { a: ['allscripts', 'veradigm'] }],
  ['netsmart', 'Netsmart', 'healthcare_it', { a: ['netsmart', 'myavatar'] }],
  ['pointclickcare', 'PointClickCare', 'healthcare_it', { a: ['pointclickcare', 'point click care'] }],
  ['medidata', 'Medidata Rave', 'healthcare_it', { a: ['medidata', 'medidata rave'] }],
  ['hl7-fhir', 'HL7 / FHIR', 'healthcare_it', { a: ['hl7', 'fhir', 'hl7 fhir'] }],
  ['benchling', 'Benchling', 'healthcare_it', { a: ['benchling'] }],
  ['labware-lims', 'LabWare LIMS', 'healthcare_it', { a: ['labware lims'] }],
  ['redcap', 'REDCap', 'healthcare_it', { cs: ['REDCap', 'REDCAP'] }],
];

// ---------------------------------------------------------------- compile
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const normAlias = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

/** Ordered technologies: { id, slug, name, category, also: [ids], req: Set(id) | null }. */
export const TECHNOLOGIES = RAW.map(([slug, name, category], id) => ({ id, slug, name, category }));
const BY_SLUG = new Map(TECHNOLOGIES.map((t) => [t.slug, t]));
const BY_CATEGORY = new Map();
for (const t of TECHNOLOGIES) (BY_CATEGORY.get(t.category) || BY_CATEGORY.set(t.category, []).get(t.category)).push(t.id);

function resolveReq(list, slug) {
  const ids = new Set();
  for (const r of list || []) {
    if (r.startsWith('@')) {
      const cat = BY_CATEGORY.get(r.slice(1));
      if (!cat) throw new Error(`tech ${slug}: unknown category ${r}`);
      for (const id of cat) ids.add(id);
    } else {
      const t = BY_SLUG.get(r);
      if (!t) throw new Error(`tech ${slug}: unknown req ${r}`);
      ids.add(t.id);
    }
  }
  return ids;
}

/**
 * Alias index: normalized literal -> [{ id, cs: exact text | null, weak, pre, post, npre, npost }]. Strong rules
 * come before weak ones for the same literal. Exported for tests (dictionary hygiene).
 */
export const ALIASES = new Map();
function addAlias(id, spec, { cs, weak, ctx = {} }) {
  const o = typeof spec === 'string' ? { w: spec } : spec;
  const key = normAlias(o.w);
  if (!key) return;
  const rule = {
    id, cs: cs ? o.w.replace(/\s+/g, ' ') : null, weak,
    pre: o.pre ?? null, post: o.post ?? null, npre: o.npre ?? ctx.npre ?? null, npost: o.npost ?? ctx.npost ?? null,
    nboth: o.nboth ?? null,
    with: (o.with || []).map((x) => {
      const t = BY_SLUG.get(x);
      if (!t) throw new Error(`alias ${o.w}: unknown with ${x}`);
      return t.id;
    }),
  };
  const list = ALIASES.get(key) || ALIASES.set(key, []).get(key);
  list.push(rule);
  list.sort((a, b) => a.weak - b.weak);
}

for (const [slug, , , spec] of RAW) {
  const t = BY_SLUG.get(slug);
  const ctx = { npre: spec.npre, npost: spec.npost };
  for (const a of spec.a || []) addAlias(t.id, a, { cs: false, weak: false, ctx });
  for (const a of spec.cs || []) addAlias(t.id, a, { cs: true, weak: false, ctx });
  for (const a of spec.w || []) addAlias(t.id, a, { cs: true, weak: true, ctx });
  t.also = (spec.also || []).map((s) => {
    const x = BY_SLUG.get(s);
    if (!x) throw new Error(`tech ${slug}: unknown also ${s}`);
    return x.id;
  });
  t.req = spec.w?.length ? resolveReq(spec.req, slug) : null;
  if (spec.w?.length && !t.req.size) throw new Error(`tech ${slug}: weak aliases need req`);
}

// One case-insensitive regex of every literal, compiled as a prefix trie ("s(?:nowflake|alesforce|...)"): a flat
// 1,500-way alternation runs at ~6 MB/s, the trie ~10x faster. At each node longer continuations come first and
// the node's own end last, so the longest literal wins ("Vue.js" over "Vue").
function trieSource(keys) {
  const root = new Map();
  const END = '';
  for (const k of keys) {
    let node = root;
    for (const tok of k.match(/ |[^ ]/g)) node = node.get(tok) || node.set(tok, new Map()).get(tok);
    node.set(END, null);
  }
  const emit = (node) => {
    const alts = [];
    let end = false;
    for (const [tok, child] of node) {
      if (tok === END) { end = true; continue; }
      alts.push((tok === ' ' ? '\\s+' : escapeRx(tok)) + (child ? emit(child) : ''));
    }
    if (!alts.length) return '';
    const body = alts.length === 1 ? alts[0] : `(?:${alts.join('|')})`;
    return end ? `(?:${body})?` : body;
  };
  return emit(root);
}
const TECH_RX = new RegExp(trieSource([...ALIASES.keys()].sort()), 'gi');
const WORDCH = /[A-Za-z0-9_À-ɏ]/;

function leftOk(text, i) {
  if (i === 0) return true;
  const c = text[i - 1];
  if (WORDCH.test(c)) return false;
  // "www.stripe.com", "careers.snowflake": a dot glued to a word on the left is part of a host name.
  if (c === '.' && i >= 2 && WORDCH.test(text[i - 2])) return false;
  if (c === '@' || c === '#' || c === '$') return false;
  return true;
}

function rightOk(text, end, alias) {
  if (end >= text.length) return true;
  const c = text[end];
  if (WORDCH.test(c)) return false;
  if ((c === '+' || c === '#') && !/[+#]$/.test(alias)) return false;
  if (c === '.' && end + 1 < text.length && /[A-Za-z0-9]/.test(text[end + 1])) return false;
  return true;
}

const CTX = 30;
// Every technology: an investor ("backed by Salesforce Ventures") or an alumni mention ("ex-Stripe") is not usage.
const NOT_USAGE_POST = /^\s+Ventures\b/;
const NOT_USAGE_PRE = /\bex-$/i;
function ruleOk(rule, text, start, end, hit) {
  if (rule.cs !== null && hit.replace(/\s+/g, ' ') !== rule.cs) return false;
  if (NOT_USAGE_POST.test(text.slice(end, end + 10)) || NOT_USAGE_PRE.test(text.slice(Math.max(0, start - 4), start))) return false;
  if (!rule.pre && !rule.npre && !rule.post && !rule.npost && !rule.nboth) return true;
  const before = text.slice(Math.max(0, start - CTX), start);
  const after = text.slice(end, end + CTX);
  if (rule.pre && !rule.pre.test(before)) return false;
  if (rule.npre && rule.npre.test(before)) return false;
  if (rule.post && !rule.post.test(after)) return false;
  if (rule.npost && rule.npost.test(after)) return false;
  // "(C)" / "(R)": copyright and registered-trademark marks, not languages.
  if (rule.nboth && rule.nboth[0].test(before) && rule.nboth[1].test(after)) return false;
  return true;
}

/**
 * Technologies named in one job's title + description -> sorted array of technology ids.
 * Weak hits count only when the job also names (strongly) a technology from that technology's `req`.
 */
export function detectTechIds(title, description, explain = null) {
  const text = description ? `${title || ''}\n${description}` : String(title || '');
  if (!text) return [];
  const strong = new Set();
  let weak = null;
  TECH_RX.lastIndex = 0;
  let m;
  while ((m = TECH_RX.exec(text)) !== null) {
    const hit = m[0];
    const start = m.index;
    const end = start + hit.length;
    if (!leftOk(text, start) || !rightOk(text, end, hit)) { TECH_RX.lastIndex = start + 1; continue; }
    const rules = ALIASES.get(normAlias(hit));
    let found = null;
    if (rules) for (const r of rules) if (ruleOk(r, text, start, end, hit)) { found = r; break; }
    if (!found) { TECH_RX.lastIndex = start + 1; continue; }
    if (found.weak) (weak ||= new Set()).add(found.id);
    else strong.add(found.id);
    for (const x of found.with) strong.add(x);
    if (explain && !explain.has(found.id)) explain.set(found.id, { hit, weak: found.weak, context: text.slice(Math.max(0, start - 40), end + 40).replace(/\s+/g, ' ') });
  }
  if (weak) {
    for (const id of weak) {
      if (strong.has(id)) continue;
      const req = TECHNOLOGIES[id].req;
      for (const s of strong) if (s !== id && req.has(s)) { strong.add(id); break; }
    }
  }
  for (const id of [...strong]) for (const a of TECHNOLOGIES[id].also) strong.add(a);
  return [...strong].sort((a, b) => a - b);
}

/** Same as detectTechIds, as slugs (tests, debugging). */
export function detectTechnologies(title, description) {
  return detectTechIds(title, description).map((id) => TECHNOLOGIES[id].slug);
}

/** Debugging / precision review: detected slug -> { hit, weak, context } of its first match (implied ones have none). */
export function explainTechnologies(title, description) {
  const explain = new Map();
  const ids = detectTechIds(title, description, explain);
  return Object.fromEntries(ids.map((id) => [TECHNOLOGIES[id].slug, explain.get(id) || { implied: true }]));
}

// ---------------------------------------------------------------- user input -> technologies
const LOOKUP = new Map();
for (const t of TECHNOLOGIES) {
  for (const k of [t.slug, t.name, t.slug.replace(/-/g, ' '), t.name.replace(/\s*\(.*?\)\s*/g, ' ')]) {
    const key = normAlias(k);
    if (key && !LOOKUP.has(key)) LOOKUP.set(key, t);
  }
}
for (const [key, rules] of ALIASES) if (!LOOKUP.has(key)) LOOKUP.set(key, TECHNOLOGIES[rules[0].id]);

/** "Snowflake", "snowflake", "k8s", "Google BigQuery", "golang" -> technology, or null. */
export function findTechnology(term) {
  const key = normAlias(term);
  if (!key) return null;
  return LOOKUP.get(key) || LOOKUP.get(key.replace(/[.\s-]+/g, ' ').trim()) || LOOKUP.get(key.replace(/[\s.-]+/g, '-')) || null;
}

/** Up to n technology names that start with / contain the term (for error messages). */
export function suggestTechnologies(term, n = 5) {
  const k = normAlias(term).replace(/[^a-z0-9]+/g, '');
  if (!k) return [];
  const flat = (s) => normAlias(s).replace(/[^a-z0-9]+/g, '');
  const starts = TECHNOLOGIES.filter((t) => flat(t.name).startsWith(k) || flat(t.slug).startsWith(k));
  const contains = TECHNOLOGIES.filter((t) => !starts.includes(t) && (flat(t.name).includes(k) || k.includes(flat(t.slug))));
  return [...starts, ...contains].slice(0, n).map((t) => t.name);
}

export const techBySlug = (slug) => BY_SLUG.get(slug) || null;

// ---------------------------------------------------------------- vendors' own boards
const flatName = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\b(?:inc|llc|ltd|limited|gmbh|corp|corporation|plc|co|company|technologies|labs|software|careers|jobs)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, '');
const SELF_KEYS = new Map(); // flattened vendor name / slug -> [technology ids]
for (const t of TECHNOLOGIES) {
  const keys = new Set([flatName(t.slug), flatName(t.name), flatName(t.name.replace(/\s*\(.*?\)\s*/g, ' '))]);
  const paren = t.name.match(/\(([^)]+)\)/);
  if (paren) keys.add(flatName(paren[1]));
  for (const k of keys) if (k.length >= 3) (SELF_KEYS.get(k) || SELF_KEYS.set(k, []).get(k)).push(t.id);
}

/**
 * Technologies that are the company itself (GitLab's jobs name GitLab, Snowflake's name Snowflake): a vendor's own
 * board says nothing about what it buys, so the build drops them. -> Set(id)
 */
export function selfTechIds(companyName, token) {
  const out = new Set();
  for (const k of [flatName(companyName), flatName(String(token ?? '').split(/[./]/)[0])]) {
    for (const id of SELF_KEYS.get(k) || []) out.add(id);
  }
  return out;
}
