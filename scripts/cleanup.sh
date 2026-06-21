#!/bin/bash

set -e

# Configuration
AWS_REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || echo "us-east-1")}"
REGION="$AWS_REGION"
REPO_NAME="nextgen-agent-trainer"
STACK_NAME="nextgen-agent-trainer-dev"
KB_STACK_NAME="nextgen-agent-trainer-dev-kb"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# All S3 buckets managed by the main stack
BUCKETS=(
  "${STACK_NAME}-transcripts-${ACCOUNT_ID}"
  "${STACK_NAME}-frontend-${ACCOUNT_ID}"
)

echo "Cleaning up AWS resources for account $ACCOUNT_ID in $REGION..."

# ============================================================
# Step 1: Empty all S3 buckets (required before CFN deletion)
# ============================================================
empty_bucket() {
  local BUCKET="$1"
  if ! aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
    echo "   $BUCKET — does not exist, skipping"
    return
  fi

  echo "   $BUCKET — emptying..."

  # Remove all current objects
  aws s3 rm "s3://$BUCKET" --recursive --region "$REGION" --quiet 2>/dev/null || true

  # Remove all versioned objects (if versioning was enabled)
  VERSIONS=$(aws s3api list-object-versions --bucket "$BUCKET" --region "$REGION" \
    --query '{Versions:Versions,DeleteMarkers:DeleteMarkers}' --output json 2>/dev/null || echo '{}')

  echo "$VERSIONS" | jq -c '(.Versions // [])[] | {Key:.Key,VersionId:.VersionId}' 2>/dev/null | \
    while IFS= read -r obj; do
      KEY=$(echo "$obj" | jq -r '.Key')
      VID=$(echo "$obj" | jq -r '.VersionId')
      aws s3api delete-object --bucket "$BUCKET" --key "$KEY" --version-id "$VID" --region "$REGION" 2>/dev/null || true
    done

  echo "$VERSIONS" | jq -c '(.DeleteMarkers // [])[] | {Key:.Key,VersionId:.VersionId}' 2>/dev/null | \
    while IFS= read -r obj; do
      KEY=$(echo "$obj" | jq -r '.Key')
      VID=$(echo "$obj" | jq -r '.VersionId')
      aws s3api delete-object --bucket "$BUCKET" --key "$KEY" --version-id "$VID" --region "$REGION" 2>/dev/null || true
    done

  echo "   $BUCKET — emptied"
}

echo ""
echo "Step 1: Emptying S3 buckets..."
for BUCKET in "${BUCKETS[@]}"; do
  empty_bucket "$BUCKET"
done
echo "Step 1 complete"

# ============================================================
# Step 2: Delete KB stack first (no bucket dependency)
# ============================================================
echo ""
echo "Step 2: Deleting Knowledge Base stack..."
KB_STACK_STATUS=$(aws cloudformation describe-stacks --stack-name $KB_STACK_NAME --region "$REGION" \
  --query "Stacks[0].StackStatus" --output text 2>/dev/null || echo "DOES_NOT_EXIST")

if [ "$KB_STACK_STATUS" != "DOES_NOT_EXIST" ] && [ "$KB_STACK_STATUS" != "DELETE_COMPLETE" ]; then
  aws cloudformation delete-stack --stack-name $KB_STACK_NAME --region "$REGION"
  echo "   Waiting for KB stack deletion..."
  aws cloudformation wait stack-delete-complete --stack-name $KB_STACK_NAME --region "$REGION"
  echo "   KB stack deleted"
else
  echo "   KB stack does not exist, skipping"
fi
echo "Step 2 complete"

# ============================================================
# Step 3: Delete main stack (buckets already empty)
# ============================================================
echo ""
echo "Step 3: Deleting main CloudFormation stack..."
MAIN_STACK_STATUS=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region "$REGION" \
  --query "Stacks[0].StackStatus" --output text 2>/dev/null || echo "DOES_NOT_EXIST")

if [ "$MAIN_STACK_STATUS" != "DOES_NOT_EXIST" ] && [ "$MAIN_STACK_STATUS" != "DELETE_COMPLETE" ]; then
  aws cloudformation delete-stack --stack-name $STACK_NAME --region "$REGION"
  echo "   Waiting for main stack deletion..."
  aws cloudformation wait stack-delete-complete --stack-name $STACK_NAME --region "$REGION"
  echo "   Main stack deleted"
else
  echo "   Main stack does not exist, skipping"
fi
echo "Step 3 complete"

# ============================================================
# Step 4: Delete ECR repository (optional — comment out to preserve images)
# ============================================================
echo ""
echo "Step 4: Deleting ECR repository..."
if aws ecr describe-repositories --repository-names $REPO_NAME --region "$REGION" 2>/dev/null; then
  aws ecr delete-repository --repository-name $REPO_NAME --region "$REGION" --force
  echo "   ECR repository deleted"
else
  echo "   ECR repository does not exist, skipping"
fi
echo "Step 4 complete"

echo ""
echo "Cleanup complete! Account is clean for a fresh deploy."
echo ""
echo "Removed:"
echo "   - S3 buckets: transcripts, frontend (emptied and deleted via CFN)"
echo "   - CloudFormation stacks: $STACK_NAME, $KB_STACK_NAME"
echo "   - ECR repository: $REPO_NAME"
echo "   - All associated resources: ECS, ALB, VPC, Cognito, DynamoDB, Lambda, AOSS, Bedrock KB"
echo ""
echo "Preserved:"
echo "   - Data bucket (nextgen-agent-trainer-data-$ACCOUNT_ID) — contains your scenario/KB files"
echo ""
echo "Next: run ./scripts/deploy.sh to redeploy from scratch"
