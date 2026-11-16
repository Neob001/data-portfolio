// Golden tests for the technology dictionary (src/core/tech.js): precision over recall, tricky negatives first.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectTechnologies, findTechnology, suggestTechnologies, TECHNOLOGIES, ALIASES, TECH_CATEGORIES,
} from '../src/core/tech.js';

const has = (title, text, slug) => detectTechnologies(title, text).includes(slug);
const yes = (text, slug, title = 'Engineer') => assert.ok(has(title, text, slug), `expected ${slug} in: ${text}`);
const no = (text, slug, title = 'Engineer') => assert.ok(!has(title, text, slug), `did not expect ${slug} in: ${text}`);

test('dictionary hygiene: unique slugs, known categories, no literal claimed by two technologies', () => {
  assert.ok(TECHNOLOGIES.length >= 250, `${TECHNOLOGIES.length} technologies`);
  assert.equal(new Set(TECHNOLOGIES.map((t) => t.slug)).size, TECHNOLOGIES.length);
  for (const t of TECHNOLOGIES) {
    assert.ok(TECH_CATEGORIES[t.category], `${t.slug}: category ${t.category}`);
    assert.match(t.slug, /^[a-z0-9][a-z0-9-]*$/, t.slug);
  }
  for (const [k, rules] of ALIASES) {
    const strong = new Set(rules.filter((r) => !r.weak).map((r) => r.id));
    assert.ok(strong.size <= 1, `alias "${k}" belongs to ${[...strong].map((i) => TECHNOLOGIES[i].slug)}`);
  }
});

test('the headline technologies are found in normal job-post prose', () => {
  const text = `About the role
You will build our data platform on Snowflake and dbt, orchestrated with Apache Airflow, and ship dashboards in Looker.
Requirements:
- 5+ years of Python and SQL
- Experience with Kubernetes, Terraform and AWS (S3, Lambda)
- Salesforce or HubSpot integrations are a plus
- Familiarity with Kafka and Spark Streaming`;
  const got = detectTechnologies('Senior Data Engineer', text);
  for (const s of ['snowflake', 'dbt', 'airflow', 'looker', 'python', 'sql', 'kubernetes', 'terraform', 'aws', 'salesforce', 'hubspot', 'kafka', 'spark']) {
    assert.ok(got.includes(s), `${s} missing from ${got}`);
  }
});

test('Go: only Golang / Go in a list of languages, never the verb', () => {
  yes('We write services in Golang.', 'go');
  yes('Backend: Python, Go, and Rust.', 'go');
  yes('Strong skills in Java, Go or C++', 'go');
  no('Ready to go? Apply now and Go beyond with us.', 'go');
  no('You will own our go-to-market motion. Python is a plus.', 'go');
  no('Go/No-Go decisions for releases (we use Python).', 'go');
  no('Python, SQL. Let\'s Go, team!', 'go'); // "Go," has no list separator before it
  no('Go, explore and grow with us', 'go'); // a list context but no other language in the post
});

test('R and C: list context with other languages only; R&D, (R), (C), grades and C-level excluded', () => {
  yes('Statistics in R, Python and SQL', 'r');
  yes('Tools: Python, R, Stata', 'r');
  no('Join our R&D team working on Python tooling', 'r');
  no('Salesforce (R) and Python', 'r');
  no('Grades A, B, R or C considered; Python preferred', 'r');
  yes('Embedded firmware in C, C++ and Python', 'c');
  yes('Experience with C/C++ on embedded Linux', 'c');
  yes('Experience with C/C++ on embedded Linux', 'cpp');
  no('Copyright (C) 2025 Acme. Python, Java.', 'c');
  no('Present to C-level executives. Python a plus', 'c');
  no('Categories A, B, C apply. Python knowledge', 'c');
  no('Series C startup using Python', 'c');
  no('Strong C# and .NET skills', 'c');
  yes('Strong C# and .NET skills', 'csharp');
  yes('Strong C# and .NET skills', 'dotnet');
  no('Modern C++ (C++20)', 'c');
});

test('Spark, Swift, Rust, Ruby, Julia: product only with technical company', () => {
  yes('Big data with PySpark and Databricks', 'spark');
  yes('Hadoop, Spark, Hive', 'spark');
  no('We spark curiosity. Spark joy in your work!', 'spark');
  no('Spark, our annual hackathon, is fun', 'spark');
  yes('iOS development with Swift and SwiftUI', 'swift');
  yes('Kotlin, Swift, TypeScript', 'swift');
  no('Knowledge of SWIFT payments and ISO 20022', 'swift');
  no('A swift response to customers; Python', 'swift');
  yes('Systems programming in C++, Rust, Go', 'rust');
  no('Rust prevention coatings for steel; Excel skills', 'rust');
  yes('Backend in Ruby, Python and Go', 'ruby');
  no('Contact Ruby Smith in HR. Python is a plus.', 'ruby');
  yes('Ruby on Rails monolith', 'rails');
  yes('Ruby on Rails monolith', 'ruby');
  no('Please send your CV to Julia Roberts. Python', 'julia');
});

test('dbt vs DBT therapy; Snowflake schema; Excel the verb; Tableau in French', () => {
  yes('Modeling in dbt and Snowflake', 'dbt');
  yes('SQL, DBT, Airflow', 'dbt');
  no('Clinician trained in DBT and CBT therapy', 'dbt');
  no('Provide DBT skills groups for adolescents', 'dbt');
  no('Familiar with star and snowflake schema design', 'snowflake');
  no('Star or Snowflake schema modelling', 'snowflake');
  yes('Our warehouse runs on Snowflake.', 'snowflake');
  yes('Advanced Excel (pivot tables, VLOOKUP)', 'excel');
  yes('Proficiency in Microsoft Excel', 'excel');
  no('You will excel in a fast-paced environment', 'excel');
  no('Excel at building relationships with clients', 'excel');
  no('Excellent communication skills', 'excel');
  yes('Reporting in Tableau and Power BI', 'tableau');
  no('Suivi du tableau de bord commercial', 'tableau');
  no('Le Tableau de bord mensuel', 'tableau');
});

test('Looker vs looking; Airflow vs HVAC airflow; React the verb; Jenkins the surname', () => {
  yes('Dashboards in Looker', 'looker');
  no('We are looking for a looker', 'looker');
  no('Looking for a data analyst', 'looker');
  no('Maintain proper airflow in the clean room', 'airflow');
  no('Airflow management for HVAC systems', 'airflow');
  yes('Pipelines in Apache Airflow', 'airflow');
  no('React quickly to customer escalations', 'react');
  no('Able to react to changing priorities', 'react');
  yes('Frontend in React and TypeScript', 'react');
  yes('CI with Jenkins and GitLab CI', 'jenkins');
  no('Reports to Sarah Jenkins, VP Sales', 'jenkins');
});

test('GCP in pharma (Good Clinical Practice) is not Google Cloud', () => {
  no('Knowledge of ICH-GCP and GLP guidelines; Excel', 'google-cloud');
  no('Ensure compliance with GCP, GMP and SOPs. SAS programming', 'google-cloud');
  yes('Cloud: AWS, GCP, Azure', 'google-cloud');
  yes('Deploy on Google Cloud Platform', 'google-cloud');
  yes('BigQuery experience', 'google-cloud'); // BigQuery is a Google Cloud product
});

test('cloud product families: a service implies its cloud', () => {
  yes('Experience with AWS Lambda and DynamoDB', 'aws');
  yes('Azure Data Factory pipelines', 'azure');
  yes('Azure Data Factory pipelines', 'azure-data-factory');
  no('Electronic medical records (EMR) experience', 'amazon-emr');
  no('Lambda calculus and functional programming', 'aws');
});

test('Workday the HR system vs the workday; SAP vs ASAP; ADP; Deel in Dutch', () => {
  yes('Experience with Workday HCM', 'workday-hcm');
  yes('HRIS: Workday, ADP', 'workday-hcm');
  yes('HRIS: Workday, ADP', 'adp');
  no('Throughout the workday you will help customers', 'workday-hcm');
  no('Workday flexibility and remote options', 'workday-hcm');
  no('Respond ASAP to tickets', 'sap');
  yes('SAP S/4HANA migration', 'sap-s4hana');
  yes('SAP S/4HANA migration', 'sap');
  no('Deel deze vacature met je netwerk', 'deel');
});

test('more ambiguous words stay out without context', () => {
  no('Our head chef runs the kitchen. Line cook, Chef, Sous chef wanted', 'chef');
  yes('Config management with Ansible, Chef or Puppet', 'chef');
  no('Puppet show for the kids event', 'puppet');
  no('The postman delivers mail daily', 'postman');
  no('Cypress Creek office, Houston', 'cypress');
  no('Join our sales outreach efforts', 'outreach');
  no('Use your notion of quality; Jira', 'notion');
  no('Head Prefect of the school council', 'prefect');
  no('Dock workers and packers needed', 'packer');
  no('Safety: wear eye protection. Selenium compounds handling in the lab', 'selenium');
  no('Flask and beaker cleaning in the chemistry lab', 'flask');
  no('A LLM degree in tax law is preferred', 'llm');
  yes('Building with LLMs and RAG pipelines', 'llm');
  no('Project RAG status reporting', 'llm');
  no('Carbon black and silica compounding in tyres', 'carbon-black');
  no('Render with Redshift, Octane or Arnold', 'redshift');
  yes('Data warehouse: Amazon Redshift', 'redshift');
  no('Master the Unity of our brand voice', 'unity');
  no('Monty Python fans welcome; Excel skills', 'python');
  no('Our Plaid shirts dress code', 'plaid');
  no('Spring cleaning event, Java', 'spring');
  yes('Java 17, Spring Boot, Hibernate', 'spring');
});

test('host names and e-mail handles are not mentions; adjacent product words are', () => {
  no('Apply at careers.snowflake.com', 'snowflake');
  no('Visit www.stripe.com', 'stripe');
  yes('Payments via Stripe and Adyen', 'stripe');
  yes('Node.js and Vue.js', 'nodejs');
  yes('Node.js and Vue.js', 'vue');
});

test('found on the real sample (2026-11-17): investor and alumni mentions, enumerators, "Key Success Factors"', () => {
  no('Backed by Databricks Ventures, ServiceNow Ventures and Workday Ventures. Python', 'servicenow');
  no('Backed by Databricks Ventures and Snowflake Ventures', 'databricks');
  no('Our team is ex-Stripe, ex-Airtable and ex-Google. Python', 'stripe');
  no('Qualifications and Key Success Factors: a PharmD', 'successfactors');
  yes('HRIS: SAP SuccessFactors', 'successfactors');
  no('Python, SQL. Meet deadlines.\nC. Team Leadership and Asset Scalability', 'c');
  no('Python and SQL.\nR. Reporting duties', 'r');
});

test('vendors\' own boards: selfTechIds names the technologies a company IS', async () => {
  const { selfTechIds } = await import('../src/core/tech.js');
  const slugs = (n, t) => [...selfTechIds(n, t)].map((i) => TECHNOLOGIES[i].slug);
  assert.deepEqual(slugs('GitLab', 'gitlab'), ['gitlab']);
  assert.deepEqual(slugs('Snowflake Inc.', 'snowflakecomputing'), ['snowflake']);
  assert.deepEqual(slugs('Salesforce', 'salesforce.wd12/External_Career_Site'), ['salesforce']);
  assert.deepEqual(slugs('Sigma Computing', 'sigmacomputing'), ['sigma-computing']);
  assert.deepEqual(slugs('Acme Analytics', 'acmeanalytics'), []);
  assert.deepEqual(slugs('Oracle', 'oracle'), []); // no plain "Oracle" technology: its products stay countable
});

test('explainTechnologies shows the matched text and context (precision reviews)', async () => {
  const { explainTechnologies } = await import('../src/core/tech.js');
  const ex = explainTechnologies('Data Engineer', 'Python, Go, and SQL on BigQuery');
  assert.equal(ex.go.hit, 'Go');
  assert.equal(ex.go.weak, true);
  assert.match(ex.go.context, /Python, Go, and SQL/);
  assert.deepEqual(ex['google-cloud'], { implied: true }); // BigQuery implies Google Cloud
});

test('title-only mentions count (Workday postings carry no description in the index)', () => {
  assert.ok(detectTechnologies('Salesforce Developer', null).includes('salesforce'));
  assert.ok(detectTechnologies('SAP Basis Administrator', '').includes('sap'));
  assert.deepEqual(detectTechnologies('Store Associate', null), []);
});

test('user input lookup: names, slugs, aliases, typos get suggestions', () => {
  assert.equal(findTechnology('Snowflake').slug, 'snowflake');
  assert.equal(findTechnology('snowflake').slug, 'snowflake');
  assert.equal(findTechnology('K8s').slug, 'kubernetes');
  assert.equal(findTechnology('golang').slug, 'go');
  assert.equal(findTechnology('Go').slug, 'go');
  assert.equal(findTechnology('Google BigQuery').slug, 'bigquery');
  assert.equal(findTechnology('power bi').slug, 'power-bi');
  assert.equal(findTechnology('C#').slug, 'csharp');
  assert.equal(findTechnology('dbt').slug, 'dbt');
  assert.equal(findTechnology('React').slug, 'react');
  assert.equal(findTechnology('Salesforce').slug, 'salesforce');
  assert.equal(findTechnology('not a tech at all'), null);
  assert.ok(suggestTechnologies('snowflak').includes('Snowflake'));
});
