import { COVER } from './cover'

export const marketing = [
  {
    id: 'mk-strategy', category: 'Marketing', name: 'Marketing Strategy',
    description: 'Market, customers, positioning, mix and plan.',
    spec: `${COVER('Marketing strategy for [Organisation], [Year]')}
# Executive summary
? The growth opportunity and how marketing will capture it.
# Market analysis
## Market size and trends
? Size, growth and the forces shaping the market.
## Competitors
| Competitor | Positioning | Strengths | Weaknesses
| ? | ? | ? | ?
| ? | ? | ? | ?
# Customers
? Segments, needs and value of each segment.
# Positioning
>! ? For [audience], [brand] is the [frame of reference] that [benefit] because [reason to believe].
# Objectives
| Objective | Measure | Target
| ? | ? | ?
# Marketing mix
## Product
?
## Price
?
## Place
?
## Promotion
?
# Plan and budget
| Initiative | Quarter | Budget | Owner
| ? | ? | ? | ?
# Measurement
? Dashboard, cadence and decision rules.`
  },
  {
    id: 'mk-brand', category: 'Marketing', name: 'Brand Strategy',
    description: 'Purpose, positioning, personality and architecture.',
    spec: `${COVER('Brand strategy for [Brand]')}
# Brand purpose
>! ? Why the brand exists beyond making money.
# Vision and mission
? Where the brand is going and how it gets there.
# Audience
? Who the brand is for, and who it is not for.
# Positioning
## Competitive frame
? The category and alternatives we compete with.
## Point of difference
? What only we can claim.
## Proof points
- ?
- ?
# Personality
| Trait | We are | We are not
| ? | ? | ?
| ? | ? | ?
# Brand architecture
? How master brand, sub-brands and products relate.
# Expression
? Verbal and visual identity principles.
# Activation
? How the brand comes to life internally and externally.`
  },
  {
    id: 'mk-gtm', category: 'Marketing', name: 'Go-to-Market Plan',
    description: 'Launch a product: segments, pricing, channels and timeline.',
    spec: `${COVER('Go-to-market plan for [Product]')}
# Product overview
? What it is, the problem it solves and what makes it different.
# Target market
## Ideal customer profile
? Firmographics or demographics, needs and buying triggers.
## Segments and priority
| Segment | Size | Priority | Why
| ? | ? | ? | ?
# Value proposition
>! ? One sentence.
# Pricing and packaging
? Pricing model, tiers and rationale.
# Channels
? Direct, partners, self-serve and marketplaces.
# Launch plan
| Phase | Date | Activities | Owner
| Pre-launch | ? | ? | ?
| Launch | ? | ? | ?
| Post-launch | ? | ? | ?
# Sales enablement
- ? Pitch deck
- ? Battle cards
- ? Demo script
# Success metrics
| Metric | 30 days | 90 days
| ? | ? | ?
# Risks
? Key risks and mitigations.`
  },
  {
    id: 'mk-proposal', category: 'Marketing', name: 'Marketing Proposal',
    description: 'A proposal for services, scope and investment.',
    spec: `${COVER('Marketing proposal for [Client]')}
# Introduction
? Thank the client and frame the opportunity.
# Objectives
? What the client wants to achieve.
# Our approach
? How we will work and why it suits the brief.
# Scope of work
| Workstream | Deliverables | Timing
| ? | ? | ?
| ? | ? | ?
# Team
? Who will work on the account.
# Case studies
? Relevant results from similar work.
# Investment
| Item | Fee
| ? | ?
| Total | ?
# Terms
? Payment terms, assumptions and validity.
# Next steps
1. ?
1. ? `
  },
  {
    id: 'mk-evaluation', category: 'Marketing', name: 'Campaign Evaluation',
    description: 'Evaluate impact, ROI and learnings after a campaign.',
    spec: `${COVER('Campaign evaluation: [Campaign]')}
# Summary
> ? Overall verdict on the campaign.
# Campaign recap
? Objectives, audience, channels, dates and budget.
# Results
| Objective | KPI | Target | Result | Variance
| ? | ? | ? | ? | ?
| ? | ? | ? | ? | ?
# Return on investment
? Revenue or value generated against total cost.
# What drove results
? Channels, messages and moments that made the difference.
# What held results back
? Barriers and missed opportunities.
# Learnings
- ?
- ?
# Recommendations
1. ?
1. ? `
  }
]
