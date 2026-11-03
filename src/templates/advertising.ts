import { COVER } from './cover'

export const advertising = [
  {
    id: 'ad-strategy', category: 'Advertising', name: 'Advertising Campaign Strategy',
    description: 'From business problem to creative and media strategy.',
    spec: `${COVER('Advertising strategy for [Brand], [Campaign]')}
# Business problem
? The commercial challenge this campaign must solve.
# Communication objective
? The shift in perception or behaviour the advertising must create.
# Target audience
? Who they are, what they care about, and their relationship with the category.
# Insight
>! ? The human truth the campaign is built on.
# Proposition
? The single most persuasive thing we can say.
# Creative strategy
? Platform idea, tone and how it extends across touchpoints.
# Media strategy
| Channel | Role | Weight | Timing
| ? TV or video | ? Reach | ? | ?
| ? Social | ? Engagement | ? | ?
| ? Search | ? Capture demand | ? | ?
| ? Out of home | ? Salience | ? | ?
# Measurement
| Objective | KPI | Target
| ? | ? | ?
# Budget
? Working and non-working spend split.`
  },
  {
    id: 'ad-brief', category: 'Advertising', name: 'Creative Brief',
    description: 'A sharp, single-page brief for creative teams.',
    spec: `? Creative brief · [Brand] · [Date]
# Why are we advertising?
? The business problem in one or two sentences.
# Who are we talking to?
? A vivid description of the person, not a demographic list.
# What do they currently think?
? Their current perception of the brand or category.
# What do we want them to think, feel or do?
? The desired response.
# What is the single most persuasive thing we can say?
>! ? One sentence.
# Why should they believe it?
- ? Reason to believe
- ? Reason to believe
# Tone of voice
? Three words that describe how it should feel.
# Mandatories
- ? Logo, legal lines, product shots
# Deliverables and timing
| Deliverable | Format | Due
| ? | ? | ?
# Budget
? Production budget.
# Approvals
? Who signs off.`
  },
  {
    id: 'ad-media-plan', category: 'Advertising', name: 'Media Campaign Plan',
    description: 'Channel mix, flighting, budget and delivery targets.',
    spec: `${COVER('Media plan for [Campaign]')}
# Campaign summary
? Objective, audience, dates and total budget.
# Audience definition
? Target audience used for planning and buying.
# Channel mix
| Channel | Budget | Share | Primary KPI
| ? | ? | ?% | ?
| ? | ? | ?% | ?
| ? | ? | ?% | ?
cap:table Budget by channel
# Flighting
| Week | Channel | Activity | Spend
| ? | ? | ? | ?
| ? | ? | ? | ?
# Targets
| Metric | Target
| ? Reach | ?
| ? Frequency | ?
| ? Cost per result | ?
# Optimisation
? How and when the plan will be adjusted in flight.
# Reporting
? Dashboards, cadence and attendees.`
  },
  {
    id: 'ad-proposal', category: 'Advertising', name: 'Campaign Proposal',
    description: 'A persuasive proposal to win approval or a pitch.',
    spec: `${COVER('Campaign proposal for [Client]')}
# Our understanding
? Restate the client's challenge in their language.
# What we recommend
? The campaign in a paragraph.
# The idea
>! ? Campaign line.
? How it comes to life.
# How it works
## Launch
? First phase.
## Sustain
? Second phase.
# Why it will work
- ? Evidence from insight
- ? Evidence from similar work
# Investment
| Item | Cost
| ? Strategy and creative | ?
| ? Production | ?
| ? Media | ?
| Total | ?
# Timeline
? Key milestones from approval to launch.
# Next steps
1. ? Approve the proposal
1. ? Kick-off workshop`
  },
  {
    id: 'ad-report', category: 'Advertising', name: 'Advertising Performance Report',
    description: 'Results against objectives with learnings.',
    spec: `${COVER('Performance report for [Campaign], [Period]')}
# Summary
> ? The headline result in one sentence.
? What worked, what did not, and what we recommend next.
# Results against objectives
| Objective | KPI | Target | Actual | Status
| ? | ? | ? | ? | ?
| ? | ? | ? | ? | ?
# Channel performance
| Channel | Spend | Impressions | CTR | Conversions | CPA
| ? | ? | ? | ? | ? | ?
| ? | ? | ? | ? | ? | ?
# Creative performance
? Which messages and formats performed best.
# Audience insight
? What we learned about the audience.
# Learnings
- ? Learning one
- ? Learning two
# Recommendations
1. ? Recommendation one
1. ? Recommendation two`
  }
]
