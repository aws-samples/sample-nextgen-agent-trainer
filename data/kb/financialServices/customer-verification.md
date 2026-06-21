# Customer Verification

## Why Verification Matters

AusFin is required under the **Banking Code of Practice**, the **Privacy Act 1988 (Cth)**, and **ASIC regulatory guidance** to verify the identity of the account holder before discussing account details or acting on any instructions. Robust verification protects customers from fraud and ensures AusFin meets its obligations as an Authorised Deposit-taking Institution (ADI).

Every inbound call must begin with verification. No account information should be shared and no transactions or changes made until verification is successfully completed.

## Standard Opening Verification

**Ask the customer for the following:**

1. Full name on the account
2. Date of birth
3. Account number or card number (last 6 digits acceptable for cards)
4. 4-digit security PIN

**Typical opening script:**
> "Thanks for calling AusFin. Before I access your account, I need to verify your identity. Could I please get your full name, date of birth, and your 4-digit security PIN?"

All four elements are required for Tier 2 and above. Do not proceed if any are missing or do not match.

## Verification Tiers

### Tier 1 — General enquiries (no account access)
**Required:** Full name only

**Permitted actions after Tier 1:**
- Provide general product and fee information (publicly available)
- Explain how to open an account or apply for a product
- Describe branch locations and contact details

### Tier 2 — Account access (view only)
**Required:** Full name + DOB + account/card number + 4-digit security PIN

**Permitted actions after Tier 2:**
- View account balances and recent transactions
- Discuss billing, direct debits, and payment history
- Explain charges on the account
- Provide account statements (verbal summary only — written statements require Tier 3)

### Tier 3 — Account changes
**Required:** All Tier 2 factors + verbal confirmation of the specific change requested

**Permitted actions after Tier 3:**
- Transfer funds between AusFin accounts
- Set up or cancel BPAY payments and direct debits
- Update postal address
- Order a replacement card (standard, non-emergency)
- Request written statements or transaction certificates

### Tier 4 — High-risk changes (OTP required)
**Required:** All Tier 2 factors + one-time password (OTP) sent to the registered mobile number

**Actions requiring Tier 4:**
- Updating registered mobile number or email address
- Adding or removing account signatories
- Increasing a credit card limit
- Changing direct debit authorities
- Requesting account closure
- International transfer setup or limit increase
- Emergency card replacement

**OTP process:**
1. Inform the customer an OTP will be sent to their registered mobile
2. OTP is valid for 5 minutes; resend once if not received
3. If the customer cannot receive the OTP, escalate to a senior banker — these changes cannot be processed by phone without OTP
4. Direct the customer to visit a branch with two forms of photo ID if OTP cannot be received

## Fraud Calls — Modified Verification Protocol

**If the customer is reporting fraud or suspicious transactions:**
- Do NOT ask the customer to confirm the disputed transaction amounts or merchant names over the phone as this can inadvertently confirm information to a potential fraudster if the account has been compromised
- Complete Tier 2 verification first, then proceed directly to securing the account
- Priority actions: block the affected card, flag the account for fraud review, issue a provisional credit if applicable
- Refer to the `account-security-fraud.md` KB article for the full fraud investigation process

## Failed Verification

**If the customer cannot complete Tier 2 verification:**
- Do not share any account details whatsoever — do not confirm balances, products held, or recent transactions
- Do not confirm that an account exists at the provided name or number
- Advise the customer of their options:
  1. Visit any AusFin branch with valid photo ID (driver's licence or passport — two forms required for account changes)
  2. Reset their security PIN via the MyAusFin app if they have online banking access
  3. Call back when they have their security PIN and account details available

**Script for failed verification:**
> "I'm sorry, I'm unable to verify your identity with the details provided. To protect your account, I'm not able to access it until your identity has been confirmed. You're welcome to visit any AusFin branch with your photo ID and we'll be happy to help you there."

**Do not:**
- Offer hints or confirm whether any individual detail (e.g., DOB, PIN) was correct
- Make exceptions based on the customer's distress or urgency — escalate to a Team Leader
- Reset a PIN verbally without completing the proper verification process

## Third-Party Callers

**Authorised representatives:**
- Check the account for an existing authority on file (Power of Attorney, authority to operate, or named authorised representative)
- Authorised representatives must provide their own full name, their relationship to the account holder, and the account holder's date of birth and account number
- The level of access and changes permitted is defined by the authority document on file

**Power of Attorney (POA):**
- A certified copy of the POA document must be on file with AusFin before the attorney can act on the account
- POA holders complete the same verification as the account holder
- POA does not automatically grant the right to close accounts or change beneficiaries — check the scope of the POA document

**Callers without authority on file:**
- Provide general information only
- Offer to add an authorised representative — the account holder must initiate this by calling 13 22 65 or visiting a branch

## Vulnerable Customers

**Signs to watch for:**
- Confusion, distress, or difficulty following the conversation
- Signs that a third party may be coaching the caller in the background
- Urgent requests to transfer funds or change account details under time pressure
- Elderly customers expressing unfamiliar urgency about account access

**What to do:**
- Do not proceed with account changes if you have concerns about whether the customer is acting freely
- For scam-related calls (customer being coached to transfer funds), follow the AusFin Scam Intervention Protocol — do not transfer funds and escalate immediately
- Refer to the AusFin Financial Hardship team (1300 308 008) or external support services as appropriate
- Document your concerns in the account notes

## Regulatory Context

- **Banking Code of Practice (ABA):** AusFin must take reasonable steps to verify identity before acting on instructions and must not share account information with unverified third parties
- **Privacy Act 1988 (Cth) — Australian Privacy Principles (APP 6):** AusFin may only disclose personal information to the account holder or an authorised representative
- **ePayments Code (ASIC):** Customer liability for unauthorised transactions is reduced when they have not contributed to the loss — proper verification procedures are part of AusFin's obligations under this code
- **Australian Financial Complaints Authority (AFCA):** Customers who believe AusFin shared their information without proper verification can lodge a complaint with AFCA on 1800 931 678 or at www.afca.org.au
