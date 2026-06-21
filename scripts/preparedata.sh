#!/bin/bash
# preparedata.sh — Upload scenario and knowledge base files to S3, then trigger
# Bedrock KB re-ingestion. Run this whenever data/scenarios/ or data/kb/ changes.
# Safe to re-run; all operations are idempotent.
#
# Usage:
#   ./scripts/preparedata.sh
#
# First-time setup: run this BEFORE deploy.sh so data is present when the
# KB stack is created and its initial ingestion job runs.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Configuration — mirrors deploy.sh defaults
AWS_REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || echo "us-east-1")}"
REGION="$AWS_REGION"
STACK_NAME="nextgen-agent-trainer-dev"
KB_STACK_NAME="nextgen-agent-trainer-dev-kb"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
DATA_BUCKET_NAME="${DATA_BUCKET_NAME:-nextgen-agent-trainer-data-${ACCOUNT_ID}}"

echo "🗂️  Preparing data files..."
echo "   Region:      $REGION"
echo "   Data Bucket: $DATA_BUCKET_NAME"
echo ""

# ── Ensure data bucket exists ──────────────────────────────────────────────────
if ! aws s3 ls "s3://$DATA_BUCKET_NAME" 2>/dev/null; then
    echo "🪣 Bucket not found — creating s3://$DATA_BUCKET_NAME..."
    if [ "$REGION" = "us-east-1" ]; then
        aws s3api create-bucket --bucket "$DATA_BUCKET_NAME" --region "$REGION"
    else
        aws s3api create-bucket --bucket "$DATA_BUCKET_NAME" --region "$REGION" \
            --create-bucket-configuration LocationConstraint="$REGION"
    fi
    aws s3api put-public-access-block \
        --bucket "$DATA_BUCKET_NAME" \
        --public-access-block-configuration \
        "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
    echo "   ✅ Bucket created: $DATA_BUCKET_NAME"
else
    echo "🪣 Bucket exists: $DATA_BUCKET_NAME"
fi
echo ""

# ── Step 1: Validate scenario JSON files ───────────────────────────────────────
echo "Step 1: Validating scenario JSON files..."
if ! "$SCRIPT_DIR/validate-scenarios.sh"; then
    echo "❌ Scenario validation failed — fix errors above and re-run."
    exit 1
fi
echo ""

# ── Step 2: Sync scenario JSON files to S3 ────────────────────────────────────
echo "Step 2: Syncing scenarios to S3..."
SCENARIOS_DIR="$PROJECT_ROOT/data/scenarios"
if [ -d "$SCENARIOS_DIR" ]; then
    SCENARIO_COUNT=$(find "$SCENARIOS_DIR" -name "*.json" | wc -l | tr -d ' ')
    if [ "$SCENARIO_COUNT" -gt 0 ]; then
        aws s3 sync "$SCENARIOS_DIR" "s3://$DATA_BUCKET_NAME/scenarios/" \
            --exclude "*" \
            --include "*.json" \
            --delete \
            --region "$REGION"
        echo "Step 2 complete: Synced $SCENARIO_COUNT scenario file(s) to s3://$DATA_BUCKET_NAME/scenarios/"
    else
        echo "Step 2: No scenario JSON files found, skipping"
    fi
else
    echo "Step 2: Scenarios directory not found, skipping"
fi

# ── Step 2b: Invoke scenario loader Lambda to reload DynamoDB ─────────────────
echo ""
echo "Step 2b: Reloading scenarios into DynamoDB..."
LOADER_FUNCTION="${STACK_NAME}-scenario-loader"
LOADER_STATUS=$(aws lambda get-function --function-name $LOADER_FUNCTION --region "$REGION" \
    --query 'Configuration.State' --output text 2>/dev/null || echo "NOT_FOUND")

if [ "$LOADER_STATUS" = "NOT_FOUND" ]; then
    echo "   Scenario loader Lambda not found — skipping (run deploy.sh first)."
else
    aws lambda invoke \
        --function-name $LOADER_FUNCTION \
        --region "$REGION" \
        --payload '{}' \
        --cli-binary-format raw-in-base64-out \
        /tmp/scenario-loader-result.json
    cat /tmp/scenario-loader-result.json
    echo ""
    echo "Step 2b complete: DynamoDB scenarios reloaded"
fi

# ── Step 3: Sync Knowledge Base markdown files to S3 ──────────────────────────
echo ""
echo "Step 3: Syncing KB files to S3..."
KB_DIR="$PROJECT_ROOT/data/kb"
if [ -d "$KB_DIR" ]; then
    KB_COUNT=$(find "$KB_DIR" -name "*.md" | wc -l | tr -d ' ')
    if [ "$KB_COUNT" -gt 0 ]; then
        aws s3 sync "$KB_DIR" "s3://$DATA_BUCKET_NAME/kb/" \
            --exclude "*" \
            --include "*.md" \
            --delete \
            --region "$REGION"
        echo "Step 3 complete: Synced $KB_COUNT KB file(s) to s3://$DATA_BUCKET_NAME/kb/"
    else
        echo "Step 3: No KB files found, skipping"
    fi
else
    echo "Step 3: KB directory not found, skipping"
fi

# ── Step 4: Trigger Bedrock KB re-ingestion ────────────────────────────────────
echo ""
echo "Step 4: Triggering Bedrock KB re-ingestion..."
KB_STACK_STATUS=$(aws cloudformation describe-stacks \
    --stack-name $KB_STACK_NAME --region "$REGION" \
    --query "Stacks[0].StackStatus" --output text 2>/dev/null || echo "DOES_NOT_EXIST")

if [ "$KB_STACK_STATUS" = "DOES_NOT_EXIST" ] || [ "$KB_STACK_STATUS" = "DELETE_COMPLETE" ]; then
    echo "   KB stack not yet deployed — skipping re-ingestion."
    echo "   Run deploy.sh to create the KB stack, then re-run preparedata.sh."
else
    KB_ID=$(aws cloudformation describe-stacks \
        --stack-name $KB_STACK_NAME --region "$REGION" \
        --query "Stacks[0].Outputs[?OutputKey=='KnowledgeBaseId'].OutputValue" \
        --output text 2>/dev/null || echo "")

    if [ -z "$KB_ID" ] || [ "$KB_ID" = "None" ]; then
        echo "   Could not retrieve KB ID from stack $KB_STACK_NAME — skipping re-ingestion."
    else
        KB_DATA_SOURCE_ID=$(aws bedrock-agent list-data-sources \
            --knowledge-base-id "$KB_ID" \
            --query "dataSourceSummaries[0].dataSourceId" \
            --output text \
            --region "$REGION" 2>/dev/null || echo "")

        if [ -n "$KB_DATA_SOURCE_ID" ] && [ "$KB_DATA_SOURCE_ID" != "None" ]; then
            aws bedrock-agent start-ingestion-job \
                --knowledge-base-id "$KB_ID" \
                --data-source-id "$KB_DATA_SOURCE_ID" \
                --region "$REGION" \
                --query 'ingestionJob.{status:status,jobId:ingestionJobId}' \
                --output json
            echo "   KB ingestion job started (runs async — content available in ~1-2 min)"
            echo "Step 4 complete: KB ID $KB_ID re-ingestion triggered"
        else
            echo "   Could not find data source for KB $KB_ID — skipping re-ingestion."
        fi
    fi
fi


# ── Step 5: Invalidate CloudFront cache ───────────────────────────────────────
echo ""
echo "Step 5: Invalidating CloudFront cache..."
CLOUDFRONT_DOMAIN=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='CloudFrontURL'].OutputValue" \
    --output text 2>/dev/null | sed 's|https://||' || echo "")

if [ -z "$CLOUDFRONT_DOMAIN" ] || [ "$CLOUDFRONT_DOMAIN" = "None" ]; then
    echo "   Main stack not yet deployed — skipping CloudFront invalidation."
else
    DISTRIBUTION_ID=$(aws cloudfront list-distributions \
        --query "DistributionList.Items[?contains(DomainName, '${CLOUDFRONT_DOMAIN}')].Id" \
        --output text 2>/dev/null || echo "")
    if [ -n "$DISTRIBUTION_ID" ] && [ "$DISTRIBUTION_ID" != "None" ]; then
        aws cloudfront create-invalidation \
            --distribution-id "$DISTRIBUTION_ID" \
            --paths "/*" \
            --region "$REGION" \
            --query 'Invalidation.{Id:Id,Status:Status}' \
            --output json
        echo "Step 5 complete: CloudFront invalidation created for $DISTRIBUTION_ID"
    else
        echo "   Could not find CloudFront distribution for $CLOUDFRONT_DOMAIN — skipping."
    fi
fi

echo ""
echo "✅ Data preparation complete."
