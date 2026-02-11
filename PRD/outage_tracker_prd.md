# Product Requirements Document (PRD)
## Outage Tracker Application

**Version:** 1.0  
**Date:** February 10, 2026  
**Author:** Victor  
**Status:** Draft

---

## 1. Executive Summary

Outage Tracker is a mobile-first web application designed to provide users with real-time visibility into service outages across multiple providers and service types. The app combines crowdsourced reports with official provider data to create a comprehensive, interactive map showing power, internet, cellular, and other service disruptions.

**Key Value Proposition:** A single, simple platform where users can quickly check the status of any service in their area and receive alerts for issues affecting their selected providers.

---

## 2. Goals & Objectives

### Primary Goals
- Provide real-time outage visibility across multiple service categories
- Create a user-friendly, intuitive interface optimized for mobile devices
- Enable users to customize their view to show only relevant outages
- Build a reliable crowdsourced reporting system with verification mechanisms

### Success Metrics
- User engagement: Daily active users and session duration
- Data quality: Percentage of verified outage reports
- Response time: Average time from outage occurrence to first report
- User retention: Percentage of users who return within 30 days

---

## 3. Target Users

### Primary Audience
- General consumers who experience service outages
- Remote workers dependent on reliable internet
- Residents in areas with frequent power/service issues
- People evaluating service provider reliability

### User Characteristics
- Age range: 18-65+
- Tech comfort level: Moderate (must be accessible to non-technical users)
- Device preference: Primarily mobile (70-80%), secondary desktop
- Usage pattern: Brief, frequent check-ins during suspected outages

---

## 4. Core Features

### 4.1 Interactive Outage Map
**Priority: CRITICAL**

**Description:**  
A mobile-optimized, interactive map displaying all reported outages with visual indicators.

**Key Requirements:**
- Color-coded markers for different outage types (power, internet, cellular, etc.)
- Severity indicators:
  - Red: Complete outage
  - Orange: Degraded service
  - Yellow: Intermittent issues
- **Intelligent zoom-based clustering:**
  - **Zoomed out view:** Multiple outages in same area consolidated into single warning indicator
    - Shows count of outages in cluster (e.g., "5 outages")
    - Color indicates highest severity in cluster
    - Prevents map clutter at city/state level
  - **Zoomed in view:** Individual outage markers become visible
    - Full detail markers appear as user zooms in
    - Each marker shows specific provider and service type
    - Smooth transition from cluster to individual markers
  - **Interactive clustering:**
    - Tap cluster indicator → Map auto-zooms to that region showing individual outages
    - OR cluster expands into "spider" view showing nearby markers
    - User can also manually zoom to see breakdown
- Smooth zoom and pan functionality
- Tap/click on markers to view outage details

**Zoom Level Behavior:**
- **Level 1 (State/Regional view):** Large clusters showing "X outages in this area"
- **Level 2 (City view):** Medium clusters by neighborhood
- **Level 3 (Street level):** Individual outage markers with full icons
- **Level 4 (Building level):** Detailed view with exact addresses

**Detail View Differences:**

*Zoomed Out Cluster Indicator:*
- Simple icon with outage count
- Dominant severity color
- Minimal information overlay
- Example: Red circle with "12" → indicates 12 outages, worst is complete

*Zoomed In Individual Marker:*
- Provider-specific icon (AT&T logo, power icon, etc.)
- Service type badge
- Severity indicator
- Time since reported
- Verification status (checkmark if confirmed)
- Tap for full popup with:
  - Provider name and service
  - Exact location/address
  - Severity and description
  - Number of confirmations
  - Estimated restoration time
  - User comments
  - Timeline view option
  - "Confirm" and "Comment" buttons

**User Flow:**
1. User opens app → Map loads with current location centered
2. At city-level zoom, user sees cluster indicators (e.g., "8 outages")
3. User taps cluster → Map zooms in OR shows spider/list of outages in that cluster
4. Individual markers now visible with provider icons
5. User taps specific marker → Full detail popup appears with all outage information
6. User can confirm, comment, or view timeline

---

### 4.2 Service Filter System
**Priority: CRITICAL**

**Description:**  
A dropdown/filter menu allowing users to customize which outages are displayed on the map.

**Key Requirements:**
- **Service Type Groups:**
  - All Power Outages
  - All WiFi/Internet Outages
  - All Cellular Outages
  - All Other Services
  
- **Individual Provider Selection:**
  - AT&T
  - Verizon
  - T-Mobile
  - Comcast/Xfinity
  - Spectrum
  - Local power companies
  - Other major providers

- **Filter Controls:**
  - "Select All" button
  - "Deselect All" button
  - Individual checkboxes for each service/provider
  - Group selection (e.g., "Show all WiFi" shows all internet providers)

**User Flow:**
1. User taps filter icon → Filter menu slides up from bottom (mobile) or appears as sidebar (desktop)
2. User deselects all → Map clears
3. User selects "AT&T" → Only AT&T outages appear
4. User applies filter → Map updates instantly

---

### 4.3 User Authentication & Personalization
**Priority: HIGH**

**Description:**  
Account system allowing users to save preferences and access personalized views.

**Key Requirements:**
- Simple registration (email + password or social login)
- Guest mode available with limited features
- Saved filter preferences persist across sessions
- Saved locations for quick access
- Profile settings for notification preferences

**Saved Preferences Include:**
- Selected service providers
- Default map view/location
- Notification settings
- Severity threshold for alerts

**User Flow:**
1. User creates account → Enters email/password
2. User selects preferred services → Saves to profile
3. User logs in later → Map loads with saved filters applied automatically
4. Guest users can browse but must create account to save preferences

---

### 4.4 Location Search
**Priority: HIGH**

**Description:**  
Search functionality allowing users to check outages by address, zip code, or city.

**Key Requirements:**
- Search bar prominently placed at top of interface
- Autocomplete suggestions as user types
- Support for multiple search formats:
  - Full address
  - Zip code
  - City, State
  - Neighborhood names
- "Use My Location" quick-access button
- Search history for logged-in users

**User Flow:**
1. User taps search bar → Keyboard appears
2. User types "90210" → Autocomplete suggests "Beverly Hills, CA 90210"
3. User selects → Map centers on location and shows nearby outages
4. User can save location for future reference

---

### 4.5 Outage Reporting System
**Priority: HIGH**

**Description:**  
Crowdsourced reporting mechanism allowing users to submit new outage reports.

**Key Requirements:**
- Simple, 3-step reporting process:
  1. Select service type and provider
  2. Confirm location (auto-detected or manual)
  3. Select severity and add optional details
  
- Required fields (minimal):
  - Service type
  - Provider
  - Location
  - Severity level
  
- Optional fields:
  - Description/notes
  - Start time (if known)
  - Affected services (e.g., "no internet + no TV")

- Verification system:
  - Other users can upvote/confirm they're experiencing same outage
  - Reports with multiple confirmations marked as "Verified"
  - Unverified reports shown with lighter opacity or different marker

**User Flow:**
1. User taps "Report Outage" button → Report form appears
2. User selects "Internet" → Selects "Comcast" from provider list
3. App auto-detects location → User confirms or adjusts pin
4. User selects "Complete Outage" severity → Adds optional note
5. User submits → Outage appears on map immediately (pending verification)

---

### 4.6 Outage Verification & Engagement
**Priority: MEDIUM**

**Description:**  
Features allowing users to confirm, update, and discuss outages.

**Key Requirements:**
- **Upvote/Confirm Button:**
  - "I'm affected too" quick-tap button
  - Shows count of confirmations
  - Users can only confirm once per outage
  
- **Comments/Updates:**
  - Users can add updates on outage status
  - Timestamp on all comments
  - Most recent update shown in outage detail view
  - Examples: "Power just came back", "Still down in my area"
  
- **Status Updates:**
  - Users can mark outage as resolved in their area
  - When multiple users confirm resolution, outage marker changes to "Resolved" status

**User Flow:**
1. User sees outage affecting them → Taps marker
2. User taps "Confirm" → Count increases, outage gains verification
3. User adds comment: "Down since 2pm" → Comment appears in timeline
4. Later: User taps "Resolved for me" → Contributes to resolution tracking

---

### 4.7 Push Notifications
**Priority: MEDIUM**

**Description:**  
Real-time alerts for outages affecting user's selected services and locations.

**Key Requirements:**
- Notification triggers:
  - New outage reported for followed services
  - Outage reported in saved locations
  - Severity escalation (degraded → complete outage)
  - Resolution updates
  
- Customizable settings:
  - Enable/disable per service type
  - Severity threshold (only notify for complete outages vs all issues)
  - Geographic radius (within 1, 5, 10 miles)
  - Quiet hours
  
- Notification content:
  - Service name and type
  - Location description
  - Severity level
  - Estimated restoration time (if available)
  - Tap to open map at outage location

**User Flow:**
1. User enables notifications → Selects AT&T and Comcast
2. AT&T outage reported nearby → User receives push notification
3. User taps notification → App opens showing outage details
4. User can confirm, add comment, or dismiss

---

### 4.8 Estimated Restoration Times
**Priority: MEDIUM**

**Description:**  
Display estimated time when service will be restored, pulled from provider APIs or user reports.

**Key Requirements:**
- Integration with provider status pages/APIs where available
- Manual entry option for crowdsourced estimates
- Display format:
  - "Estimated restoration: 4:30 PM"
  - "Restoration: Unknown"
  - "Restored: 2:15 PM"
- Countdown timer for outages with known ETA
- Historical accuracy tracking for provider estimates

**User Flow:**
1. User views outage → Sees "Estimated restoration: 5:00 PM"
2. Time updates as provider revises estimate
3. When restored → Status changes to "Resolved at 4:45 PM"

---

### 4.9 Outage Timeline View
**Priority: MEDIUM**

**Description:**  
Chronological view of outage lifecycle from report to resolution.

**Key Requirements:**
- Timeline displays:
  - Initial report timestamp
  - Verification confirmations
  - Status updates from users
  - Provider updates (if available)
  - Severity changes
  - Resolution time
  
- Visual timeline format:
  - Vertical timeline on mobile
  - Shows time gaps clearly
  - Icons for different event types
  
- Filter timeline by event type

**User Flow:**
1. User opens outage details → Taps "Timeline" tab
2. Sees complete history: "Reported at 2:15 PM → 15 confirmations by 2:30 PM → Provider acknowledged 3:00 PM → Resolved 4:45 PM"
3. User can review user comments and updates chronologically

---

### 4.10 Outage History
**Priority: LOW**

**Description:**  
Historical record of past outages for analysis and provider reliability comparison.

**Key Requirements:**
- Access to resolved outages up to 90 days back
- Filter history by:
  - Date range
  - Service type
  - Provider
  - Location
  
- Summary statistics:
  - Total outages in period
  - Average duration
  - Most affected areas
  
- Individual outage details preserved (timeline, comments, etc.)

**User Flow:**
1. User taps "History" → Selects date range "Last 30 days"
2. User filters to "Comcast" in their zip code
3. Sees list of 3 past outages with durations
4. User taps one → Views complete timeline and details

---

### 4.11 Statistics Dashboard
**Priority: LOW**

**Description:**  
Visual analytics showing provider reliability and outage patterns.

**Key Requirements:**
- Provider comparison charts:
  - Outage frequency by provider
  - Average outage duration
  - Reliability score (uptime %)
  
- Geographic analysis:
  - Heatmap of most affected areas
  - Neighborhood/zip code rankings
  
- Temporal patterns:
  - Outage frequency by time of day
  - Seasonal trends
  
- Filters:
  - Time period (7/30/90 days)
  - Service type
  - Geographic area

**User Flow:**
1. User taps "Stats" → Views provider comparison for their area
2. Sees "AT&T: 3 outages/month avg, 2.5hr avg duration"
3. User switches to heatmap → Identifies their neighborhood as high-incident area
4. User uses data to inform provider selection decisions

---

### 4.12 Heatmap Visualization
**Priority: LOW**

**Description:**  
Color-coded overlay showing geographic concentration of outages over time.

**Key Requirements:**
- Heat intensity based on:
  - Outage frequency
  - Total downtime hours
  - Number of affected users
  
- Toggle between current and historical heatmap
- Filter by service type
- Adjustable time window (24hrs, 7 days, 30 days)
- Legend showing intensity scale

**User Flow:**
1. User taps "Heatmap" view toggle
2. Map transitions to heat overlay showing red zones (frequent outages) and green zones (reliable)
3. User selects "Last 30 days" → Heatmap updates with historical data
4. User identifies patterns (e.g., certain areas always affected during storms)

---

## 5. User Experience Priorities

### 5.1 Mobile-First Design Philosophy

**Critical Requirements:**
- All core features accessible within 2 taps from home screen
- Large touch targets (minimum 44x44px)
- Bottom navigation for primary actions (thumb-friendly)
- Minimal text entry required
- Fast load times (< 3 seconds on 4G)
- Progressive Web App (PWA) for app-like experience

**Layout Priorities:**
1. Map takes 70-80% of screen real estate
2. Essential controls overlaid on map (not hidden in menus)
3. Swipe gestures for common actions (swipe up for filters, swipe down to refresh)
4. Sticky search bar at top
5. Floating action button (FAB) for "Report Outage"

---

### 5.2 Simplicity Guidelines

**Interface Principles:**
- **One primary action per screen**
- **Maximum 3 steps for any user task**
- **No feature should require tutorial/help text** (intuitive by design)
- **Consistent icon language** throughout app
- **Clear visual hierarchy** with generous white space

**Complexity Management:**
- Hide advanced features behind "More Options" or settings
- Default to most common use case
- Progressive disclosure (show basic options first, advanced on request)
  - Example: Zoom-based clustering shows simple count when zoomed out, full details when zoomed in
- Smart defaults based on user location and common choices

**Examples:**
- ✅ Good: "Report Outage" → Select service → Submit (2 taps + 1 selection)
- ❌ Bad: "Report" → Service type → Provider → Subcategory → Location type → Indoor/outdoor → etc.
- ✅ Good: Zoomed out map shows "12 outages" cluster → Tap/zoom → Individual markers with details
- ❌ Bad: All 12 markers visible at city level causing visual clutter

---

### 5.3 Performance Standards

**Target Metrics:**
- Map initial load: < 2 seconds
- Filter application: < 0.5 seconds
- Report submission: < 1 second
- Search results: < 0.5 seconds
- Notification delivery: < 30 seconds from outage report

**Optimization Strategies:**
- Lazy loading for map markers (load visible area first)
- Intelligent clustering to reduce marker count at zoom-out levels
  - Dynamic cluster calculation based on viewport
  - Only render individual markers when zoomed in sufficiently
- Caching of provider data and user preferences
- Efficient database queries with geographic indexing
- CDN for static assets
- Service worker for offline capability

---

## 6. Technical Requirements

### 6.1 Data Sources

**Hybrid Approach: Crowdsourced + Official APIs**

**Crowdsourced Data:**
- Primary source for real-time ground truth
- User-submitted reports with verification system
- Upvotes/confirmations increase reliability
- Geographic clustering to identify patterns

**Official Provider APIs:**
- Pull from provider status pages where available
- Examples:
  - Downdetector API
  - Individual provider status APIs (AT&T, Comcast, etc.)
  - Power company outage maps
- Used to:
  - Validate crowdsourced reports
  - Provide estimated restoration times
  - Auto-update outage status

**Data Validation:**
- Cross-reference user reports with official data
- Flag discrepancies for manual review
- Weight official sources higher for ETAs
- Use crowdsourced data for providers without public APIs

---

### 6.2 Technology Stack Recommendations

**Frontend:**
- React or React Native (mobile-first, cross-platform)
- Mapbox GL JS or Google Maps API for mapping
  - Must support marker clustering (e.g., Mapbox Supercluster, Google Maps MarkerClusterer)
  - Custom cluster styling for severity indication
  - Smooth zoom animations between cluster levels
- Progressive Web App (PWA) capabilities
- Responsive CSS framework (Tailwind CSS or similar)

**Backend:**
- Node.js with Express or Python with FastAPI
- PostgreSQL with PostGIS extension (geospatial queries)
- Redis for caching and real-time features
- WebSocket or Server-Sent Events for live updates

**Infrastructure:**
- Cloud hosting (AWS, Google Cloud, or Azure)
- CDN for asset delivery
- Load balancing for scalability
- Scheduled jobs for API polling

**Third-Party Services:**
- Push notification service (Firebase Cloud Messaging or OneSignal)
- Authentication service (Auth0 or Firebase Auth)
- Geocoding API (Google Maps or Mapbox)
- Email service (SendGrid or AWS SES)

---

### 6.3 Security & Privacy

**Data Protection:**
- HTTPS everywhere
- Encrypted password storage (bcrypt)
- Secure session management
- Rate limiting to prevent abuse
- Input sanitization to prevent injection attacks

**User Privacy:**
- Optional account creation (guest mode available)
- Minimal personal data collection
- Location data never shared with third parties
- Clear privacy policy and terms of service
- GDPR/CCPA compliance for data deletion requests

**Content Moderation:**
- Report flagging system for spam/abuse
- Automated filtering for inappropriate content
- Admin dashboard for manual review
- User reputation system (karma/trust score)

---

### 6.4 Scalability Considerations

**Growth Planning:**
- Database sharding by geographic region
- Horizontal scaling for web servers
- Message queue for async tasks (report processing, notifications)
- Geographic load balancing
- API rate limiting per user tier

**Expected Load:**
- Phase 1 (Launch): 10,000 users, 100K requests/day
- Phase 2 (6 months): 100,000 users, 1M requests/day
- Phase 3 (1 year): 500,000 users, 5M requests/day

---

## 7. Feature Prioritization (MVP vs Future)

### Minimum Viable Product (MVP) - Launch Features
**Timeline: 3-4 months**

**Must Have:**
1. Interactive outage map with real-time updates
2. Service filter system (type + provider)
3. Basic outage reporting (service, location, severity)
4. Upvote/confirm functionality
5. Location search (address/zip)
6. User accounts with saved preferences
7. Guest mode for browsing
8. Mobile-responsive design
9. Push notifications (basic: new outage alerts)

**Why this MVP:**
- Core value proposition delivered (see outages, report issues, customize view)
- Sufficient for user validation and feedback
- Technically achievable in reasonable timeframe
- Creates network effect (more users = better data)

---

### Phase 2 Features - Post-Launch (Months 4-8)
**Based on user feedback and usage patterns**

1. Official provider API integration
2. Estimated restoration times
3. Outage timeline view
4. Enhanced notification customization
5. Comments/updates on outages
6. Desktop optimization

---

### Phase 3 Features - Advanced (Months 9-12)
**Nice-to-have analytics and engagement features**

1. Statistics dashboard
2. Provider reliability comparison
3. Heatmap visualization
4. Outage history (90-day archive)
5. Advanced filtering options
6. Email digest reports
7. Widget for home screen

---

## 8. Success Criteria

### Launch Metrics (First 3 Months)

**User Acquisition:**
- 10,000 registered users
- 30,000 total app visits
- 40% mobile traffic
- 20% user retention (return within 7 days)

**Engagement:**
- 500 outage reports submitted
- 2,000 upvotes/confirmations
- Average session duration: 3+ minutes
- 50% of users enable notifications

**Data Quality:**
- 70% of reports verified (multiple confirmations)
- Average report-to-resolution time: 4 hours
- < 5% spam/false reports

**Technical:**
- 99.5% uptime
- < 3 second average page load
- < 1% error rate

---

### Long-Term Success Indicators (Year 1)

**Market Position:**
- Recognized as go-to outage tracker in 3+ major cities
- Partnership with at least 2 service providers
- Media coverage/press mentions
- 4.0+ star rating in app stores

**Community Growth:**
- 100,000+ registered users
- Active community with regular engagement
- User-generated content (reports, comments) growing 20% MoM
- Low churn rate (< 30% quarterly)

**Business Viability:**
- Path to monetization identified (freemium, ads, or B2B)
- Operating costs covered by revenue or funding
- Sustainable growth trajectory

---

## 9. Risks & Mitigation

### Technical Risks

**Risk:** Poor data quality from crowdsourced reports (spam, false reports)  
**Mitigation:** 
- Implement verification system with upvotes
- Use reputation scoring for users
- Cross-reference with official APIs
- Manual moderation for flagged content

**Risk:** Scalability issues during major outage events (traffic spike)  
**Mitigation:**
- Cloud auto-scaling
- CDN for static content
- Database optimization with geographic indexing
- Load testing before launch

**Risk:** API dependencies (provider APIs going down or changing)  
**Mitigation:**
- Design for API failure gracefully
- Cache provider data
- Crowdsourced data as fallback
- Multiple data source integration

---

### Product Risks

**Risk:** Low user adoption (chicken-egg problem: few users = little data)  
**Mitigation:**
- Seed with data from existing outage tracking sites
- Partner with local community groups
- Targeted launch in areas with frequent outages
- Incentivize early reporting (gamification)

**Risk:** User confusion/complexity (feature creep)  
**Mitigation:**
- Ruthless prioritization (MVP focused on core value)
- Extensive user testing
- Onboarding flow for first-time users
- Progressive disclosure of advanced features

**Risk:** Privacy concerns (location tracking fears)  
**Mitigation:**
- Transparent privacy policy
- Optional account creation
- Location data only used for map display
- Clear opt-in for notifications
- GDPR/CCPA compliance

---

### Competitive Risks

**Risk:** Existing players (Downdetector, provider maps) already established  
**Mitigation:**
- Focus on superior mobile UX (our differentiator)
- Multi-service aggregation (one app for all)
- Personalization features (saved preferences)
- Community features (comments, verification)

**Risk:** Providers launching their own tracking tools  
**Mitigation:**
- Multi-provider aggregation is our moat
- Neutral third-party perspective valuable
- Faster updates via crowdsourcing
- Consider B2B partnerships with providers

---

## 10. Development Roadmap

### Phase 1: MVP Development (Months 1-4)

**Month 1: Foundation**
- Technical architecture design
- Database schema design
- Map integration setup
- Basic UI framework

**Month 2: Core Features**
- Map with marker display
- Outage reporting form
- Filter system implementation
- User authentication

**Month 3: Polish & Testing**
- Mobile optimization
- Push notification setup
- User testing & feedback
- Bug fixes & refinements

**Month 4: Pre-Launch**
- Performance optimization
- Security audit
- Beta testing with 100 users
- Marketing materials prep

### Phase 2: Launch & Iteration (Months 5-8)
- Public launch
- Monitor metrics & user feedback
- Rapid iteration on pain points
- Provider API integration
- Enhanced features (timeline, comments)

### Phase 3: Growth & Scale (Months 9-12)
- Analytics features
- Desktop optimization
- Partnership development
- Expansion to new regions

---

## 11. Open Questions & Decisions Needed

### Product Decisions
1. **Monetization strategy:** Free with ads? Freemium model? B2B partnerships?
2. **Geographic scope:** Launch locally or nationwide? International later?
3. **Provider coverage:** Which providers to support at launch? (Top 10? Top 20?)
4. **Moderation approach:** Automated only or human moderators?
5. **Branding:** App name, visual identity, tone of voice?

### Technical Decisions
1. **Mapping provider:** Google Maps vs Mapbox vs OpenStreetMap?
2. **Hosting:** AWS, Google Cloud, Azure, or other?
3. **Development approach:** Native apps vs PWA vs hybrid?
4. **Database choice:** PostgreSQL vs MongoDB vs other?
5. **Real-time updates:** WebSockets vs Server-Sent Events vs polling?

### Business Decisions
1. **Legal structure:** LLC, C-Corp, nonprofit?
2. **Initial funding:** Bootstrapped, angel, VC?
3. **Team composition:** Solo founder or team? Roles needed?
4. **Launch strategy:** Soft launch vs press push vs viral marketing?
5. **Success threshold:** What metrics determine go/no-go for Phase 2?

---

## 12. Appendix

### A. Competitive Landscape

**Existing Solutions:**

1. **Downdetector**
   - Strengths: Established brand, wide provider coverage
   - Weaknesses: Cluttered interface, primarily desktop-focused, no personalization
   
2. **Provider-Specific Maps** (e.g., Xfinity outage map)
   - Strengths: Official data, accurate ETAs
   - Weaknesses: Must check each provider separately, limited to one company
   
3. **Local Utility Outage Maps**
   - Strengths: Accurate for power outages
   - Weaknesses: Only cover electricity, regional fragmentation

**Our Differentiation:**
- Superior mobile experience (mobile-first design)
- Multi-service aggregation (one app for all)
- Personalization (saved preferences, custom notifications)
- Community verification system
- Modern, clean interface

---

### B. User Personas

**Persona 1: Remote Worker Rachel**
- Age: 32
- Location: Suburban area
- Use case: Needs reliable internet for work-from-home; wants immediate alerts for internet outages
- Pain point: Wastes time troubleshooting when it's actually a provider issue
- Feature priorities: Internet outage alerts, ETA for restoration, AT&T/Comcast filtering

**Persona 2: Prepared Phil**
- Age: 45
- Location: Hurricane-prone region
- Use case: Tracks power and cellular outages during storms; helps neighbors stay informed
- Pain point: Checking multiple sources (power company, carrier sites, news)
- Feature priorities: Multi-service view, location search, report submission

**Persona 3: Urban Student Sara**
- Age: 21
- Location: City apartment
- Use case: Checks app when internet goes down to see if it's her router or ISP
- Pain point: Doesn't know if outage is local or widespread
- Feature priorities: Quick confirmation, upvote functionality, mobile-optimized

---

### C. Initial Provider List (Launch)

**Internet/WiFi:**
- Comcast/Xfinity
- Spectrum
- AT&T Internet
- Verizon Fios
- Cox
- CenturyLink
- Google Fiber (where available)

**Cellular:**
- AT&T
- Verizon
- T-Mobile
- US Cellular
- Cricket Wireless
- Metro by T-Mobile

**Power:**
- Major utilities by region (e.g., PG&E, Con Edison, Duke Energy)
- Municipality power companies

**Other:**
- Major cable TV providers
- Popular VoIP services (Vonage, Ooma)
- Water utilities (if user interest)

---

### D. Glossary

**Terms used in this PRD:**

- **Outage:** Complete or partial loss of service
- **Severity:** Level of impact (complete, degraded, intermittent)
- **Verification:** Confirmation from multiple users that outage exists
- **Crowdsourced:** Data collected from user reports
- **ETA:** Estimated Time of Arrival (when service will be restored)
- **Upvote:** User confirmation that they are also experiencing the outage
- **Heatmap:** Visual representation of outage frequency/intensity by geography
- **MVP:** Minimum Viable Product - essential features for launch
- **PWA:** Progressive Web App - web app that behaves like native app
- **PostGIS:** PostgreSQL extension for geographic data

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Feb 10, 2026 | Victor | Initial draft |

---

**Next Steps:**
1. Review and approve PRD with stakeholders
2. Create detailed technical specifications
3. Design mockups and user flows
4. Set up development environment
5. Begin Phase 1 development

**Questions or Feedback:**  
Contact: [Your contact information]
