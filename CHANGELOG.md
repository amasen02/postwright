# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0]

### Added

- `draft` command: stage a topic into local X, LinkedIn, and dev.to drafts plus a manifest,
  with an optional native GIF generated via the sibling `diagif` tool (mindmap or diagram
  visuals).
- `lint` command: check a draft, or all drafts, against twelve measured evidence gates
  (R1-R12) covering opener form, banned patterns, length/structure, link placement,
  topic specificity, LinkedIn link and visual rules, GIF brand provenance, dev.to
  engagement evidence, duplicate-title detection, release cadence, and private-data
  leakage.
- `status` command: print the current gate state for one or all drafts without
  publishing anything.
- `release` command: publish a single channel (`x`, `devto`, or `linkedin`) for a draft,
  gated behind an explicit `--channel` and `--confirm` flag. Every publisher reads its
  result back from the live page or API before a release is reported as successful;
  an unconfirmed outcome is never reported as a clean failure.
- `auth` command: report credential and account-verification availability per channel
  without ever printing credential values.
- `doctor` command: check local environment health (config, paths, dependencies).
- X publisher, LinkedIn publisher, and dev.to publisher, all reachable only through
  `release --confirm`.
