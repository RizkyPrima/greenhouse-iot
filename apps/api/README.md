<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Plant AI recommendations (Phase 10.7)

The recommendation provider uses Gemini's official OpenAI-compatible endpoint. Configure
`LLM_API_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` in the backend environment; never put the
API key in frontend code, source control, or logs. `LLM_MODEL` is deliberately not defaulted:
check the [model list](https://ai.google.dev/gemini-api/docs/models) and active
[AI Studio rate limits](https://aistudio.google.com/rate-limit?timeRange=last-28-days) for your
project before choosing a model ID. Gemini 3.1 Flash-Lite is a text-output model with
[documented structured-output support](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite);
use it only if it is listed and enabled for your project.

The first request requires a published source Plant Standard, a validated profile version,
one of its growth stages, and verified evidence matching the crop, stage, and parameter.
With a backend JWT for an organization owner/admin, send:

```powershell
curl.exe -X POST "http://localhost:3001/api/organizations/<ORG_ID>/plant-profiles/<PROFILE_ID>/recommendations" `
  -H "Authorization: Bearer <JWT>" `
  -H "Content-Type: application/json" `
  -d "{\"profileVersionId\":\"<VALIDATED_PROFILE_VERSION_ID>\",\"growthStageId\":\"<GROWTH_STAGE_ID>\"}"
```

The website's `/plant-ai-recommendations` page also supports recording organization evidence.
An evidence record is always created as `UNVERIFIED`; an owner/admin must inspect the cited
source and locator and submit a review reason before it can enter AI retrieval. The evidence
list endpoint is `GET /organizations/:organizationId/scientific-evidence`; it returns the
organization's records plus globally verified records, not unverified records from other
organizations. Evidence may cite an HTTP(S) canonical URL or an existing registered source.

Each validated profile version is pinned to one published catalog version. Adding definitions
to a newer catalog draft does not change older profile versions: publish the draft, create a
new profile draft, adopt the newly published catalog version, validate that profile version,
then select it in the recommendation page. Parameter schemas can define type and unit without
inventing agronomic thresholds; numeric evidence must use the exact catalog unit to be eligible.

The API retrieves matching verified evidence, requests structured JSON from Gemini, and
passes the result through the existing validator and proposal workflow. It does not publish
standards or control actuators. Provider, key, quota, timeout, and invalid-output failures
return structured errors and do not create a proposal.

## AI Plant Setup

The website's primary entry point is `/plant-setup` (shown as **Konfigurasi Tanaman**). It sends the
plant identity and cultivation method to the configured Gemini provider to propose parameter identities and growth-stage labels.
The response schema intentionally has no fields for values, ranges, units, citations, or source
URLs. Those are not produced as facts or marked verified. The user reviews/edits candidates and
can save a tenant-scoped catalog version as `DRAFT`; the version is never published by generation.
Manual parameter/stage changes and their origin are recorded in the existing configuration audit.
Source search is not part of this call: the Research Source Registry requires its existing platform
permission. The setup page does not fabricate recommendations, citations, or source matches; use
the evidence workflow and the existing recommendation engine after the profile is validated.
The explicit **Setujui & terbitkan standar** action calls the existing catalog publish validator,
then creates or adopts a profile draft from that published version. The profile remains a draft
until its existing profile validation workflow is completed. Catalog/profile state can be resumed
from the setup page; published standards remain immutable.

After the standard is published, the same page can list compatible ESP32-S3 devices and their last
reported monitoring capability. Applying a selection is a separate, explicit OWNER/ADMIN action.
The API publishes a versioned monitoring-only payload to the device's `/config` topic, while the
firmware's actuator handler remains isolated on `/command`. The page distinguishes broker publish,
device receipt, and confirmed application. The current firmware reports simulated sensor data and
supports only air temperature, relative humidity, soil moisture, and light intensity; pH, TDS, and
water temperature are not remotely configurable on this firmware.

This delivery feature requires the additive migration
`prisma/migrations/20261028170000_phase10_7_monitoring_config_delivery/migration.sql`. No migration
is run by the application or this workflow. Confirm the target database, then apply it using the
approved deployment procedure before invoking:

- `GET /organizations/:organizationId/plant-config-devices`
- `POST /organizations/:organizationId/devices/:deviceId/plant-configurations`
- `GET /organizations/:organizationId/device-plant-configurations/:configurationId`

The firmware reports support in status heartbeats and acknowledges on `/response` using
`type: "plant_config"`. Broker publish success alone never means the device applied the configuration.

The corresponding owner/admin endpoint is
`POST /organizations/:organizationId/plant-setups/generate`. Its request includes `commonName`,
`cultivationMethod` (`hydroponic_tower`, `hydroponic_nft`, `hydroponic_dwc`, `soil`, or `other`),
and optional scientific name, cultivar, and stage context. It writes no database rows.
`POST /organizations/:organizationId/plant-catalog` and the existing draft-version/parameter APIs
are used only after the user chooses **Simpan draft setup**. A live provider smoke test is opt-in:
set `LLM_LIVE_TEST=true` in the API test process (with the three LLM variables configured) and run
`npm test -- --no-file-parallelism src/plants/gemini.live.spec.ts` from `apps/api`. Without this
flag, the live test is skipped; mocked provider tests do not establish live Gemini availability.

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

To add it to this project:

```bash
$ npm install @nestjs/observe
```

Then follow the [setup guide](https://docs.nestjs.com/observability/overview) - it takes a single import and an app key.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
