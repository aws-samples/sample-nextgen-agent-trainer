#!/bin/bash

set -e

# Configuration
AWS_REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || echo "us-east-1")}"
REGION="$AWS_REGION"
REPO_NAME="nextgen-agent-trainer"
STACK_NAME="nextgen-agent-trainer-dev"
KB_STACK_NAME="nextgen-agent-trainer-dev-kb"

# LLM Model Configuration (defaults)
NOVA_MODEL_ID="${1:-amazon.nova-2-sonic-v1:0}"
REASONING_MODEL_ID="${2:-global.anthropic.claude-sonnet-4-5-20250929-v1:0}"
SUGGESTIONS_MODEL_ID="${SUGGESTIONS_MODEL_ID:-us.anthropic.claude-haiku-4-5-20251001-v1:0}"
KB_SCORE_THRESHOLD="${KB_SCORE_THRESHOLD:-0.5}"

# Get AWS Account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}"

# Data bucket name — defaults to nextgen-agent-trainer-data-{accountId} if not provided
DATA_BUCKET_NAME="${3:-nextgen-agent-trainer-data-${ACCOUNT_ID}}"


echo ""
echo "🚀 Starting deployment..."
echo "📋 Configuration:"
echo "   - AWS Account: $ACCOUNT_ID"
echo "   - Region: $REGION"
echo "   - Nova Model: $NOVA_MODEL_ID"
echo "   - Reasoning Model: $REASONING_MODEL_ID"
echo "   - Data Bucket: $DATA_BUCKET_NAME"

# Generate a unique timestamp to force scenario reload on every deploy
DEPLOY_TIMESTAMP=$(date +%s)

# Create ECR repository if it doesn't exist
echo ""
echo "📦 Creating ECR repository..."
aws ecr describe-repositories --repository-names $REPO_NAME --region "$REGION" 2>/dev/null || \
aws ecr create-repository --repository-name $REPO_NAME --region "$REGION"

# Login to ECR
echo "🔐 Logging into ECR..."
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_URI"

# Build and push Docker image
echo ""
echo "🏗️ Building Docker image..."
echo "   - Building from: backend/"
echo "   - TypeScript compilation happens inside container"
docker build --platform=linux/amd64 -t $REPO_NAME backend/
docker tag $REPO_NAME:latest "$ECR_URI":latest

docker push "$ECR_URI":latest
echo "Step 1 complete: Docker image pushed to ECR"

# ============================================================
# Step 2: Deploy main CloudFormation stack (no KB dependency)
# ============================================================
echo ""
echo "Step 2: Deploying main CloudFormation stack..."

# Check if KB stack already exists and has a KB ID from a previous deploy
EXISTING_KB_ID=""
KB_STACK_STATUS=$(aws cloudformation describe-stacks --stack-name $KB_STACK_NAME --region "$REGION" --query "Stacks[0].StackStatus" --output text 2>/dev/null || echo "DOES_NOT_EXIST")
if [ "$KB_STACK_STATUS" != "DOES_NOT_EXIST" ] && [ "$KB_STACK_STATUS" != "DELETE_COMPLETE" ]; then
    EXISTING_KB_ID=$(aws cloudformation describe-stacks --stack-name $KB_STACK_NAME --region "$REGION" \
      --query "Stacks[0].Outputs[?OutputKey=='KnowledgeBaseId'].OutputValue" --output text 2>/dev/null || echo "")
fi

aws cloudformation deploy \
  --template-file infrastructure/cloudformation/nextgen-agent-trainer.yaml \
  --stack-name $STACK_NAME \
  --parameter-overrides \
    DockerImageURI="$ECR_URI":latest \
    NovaModelId="$NOVA_MODEL_ID" \
    ReasoningModelId="$REASONING_MODEL_ID" \
    SuggestionsModelId="$SUGGESTIONS_MODEL_ID" \
    KbScoreThreshold="$KB_SCORE_THRESHOLD" \
    DataBucketName="$DATA_BUCKET_NAME" \
    KnowledgeBaseId="${EXISTING_KB_ID}" \
    DeployTimestamp="$DEPLOY_TIMESTAMP" \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --region "$REGION"
echo "Step 2 complete: Main stack deployed"

# ============================================================
# Step 3: Deploy Knowledge Base stack (only if not already deployed)
# ============================================================
echo ""
echo "Step 3: Knowledge Base stack..."
if [ -n "$EXISTING_KB_ID" ] && [ "$EXISTING_KB_ID" != "None" ]; then
    echo "   KB stack already deployed (KB ID: $EXISTING_KB_ID) — skipping"
    echo "   Run scripts/preparedata.sh to sync data and trigger re-ingestion."
    KB_ID="$EXISTING_KB_ID"
    echo "Step 3 skipped"
else
    echo "   No existing KB found — deploying KB stack..."
    echo "   (AOSS index creation includes retry logic for eventual consistency)"
    aws cloudformation deploy \
      --template-file infrastructure/cloudformation/nextgen-agent-trainer-kb.yaml \
      --stack-name $KB_STACK_NAME \
      --parameter-overrides \
        DataBucketName="$DATA_BUCKET_NAME" \
      --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
      --region "$REGION"

    KB_ID=$(aws cloudformation describe-stacks \
      --stack-name $KB_STACK_NAME \
      --query "Stacks[0].Outputs[?OutputKey=='KnowledgeBaseId'].OutputValue" \
      --output text \
      --region "$REGION")
    echo "   Knowledge Base ID: $KB_ID"
    echo "Step 3 complete: Knowledge Base stack deployed"

    # ── Step 3b: Update main stack with KB ID ──
    echo ""
    echo "Step 3b: Linking Knowledge Base to main stack..."
    aws cloudformation deploy \
      --template-file infrastructure/cloudformation/nextgen-agent-trainer.yaml \
      --stack-name $STACK_NAME \
      --parameter-overrides \
        DockerImageURI="$ECR_URI":latest \
        NovaModelId="$NOVA_MODEL_ID" \
        ReasoningModelId="$REASONING_MODEL_ID" \
        SuggestionsModelId="$SUGGESTIONS_MODEL_ID" \
        KbScoreThreshold="$KB_SCORE_THRESHOLD" \
        DataBucketName="$DATA_BUCKET_NAME" \
        KnowledgeBaseId="$KB_ID" \
        DeployTimestamp="$DEPLOY_TIMESTAMP" \
      --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
      --region "$REGION"
    echo "Step 3b complete: Main stack updated with KB ID"
fi

# ============================================================
# Step 4: Read CloudFormation outputs
# ============================================================
echo ""
echo "Step 4: Reading CloudFormation outputs..."
CF_OUTPUTS=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query "Stacks[0].Outputs" \
  --output json \
  --region "$REGION")

COGNITO_USER_POOL_ID=$(echo "$CF_OUTPUTS" | python3 -c "import sys,json; o=json.load(sys.stdin); print(next(x['OutputValue'] for x in o if x['OutputKey']=='UserPoolId'))" 2>/dev/null || echo "")
COGNITO_CLIENT_ID=$(echo "$CF_OUTPUTS" | python3 -c "import sys,json; o=json.load(sys.stdin); print(next(x['OutputValue'] for x in o if x['OutputKey']=='UserPoolClientId'))" 2>/dev/null || echo "")
COGNITO_DOMAIN=$(echo "$CF_OUTPUTS" | python3 -c "import sys,json; o=json.load(sys.stdin); print(next(x['OutputValue'] for x in o if x['OutputKey']=='UserPoolDomain'))" 2>/dev/null || echo "")
CLOUDFRONT_DOMAIN=$(echo "$CF_OUTPUTS" | python3 -c "import sys,json; o=json.load(sys.stdin); v=next(x['OutputValue'] for x in o if x['OutputKey']=='CloudFrontURL'); print(v.replace('https://',''))" 2>/dev/null || echo "")
FRONTEND_BUCKET=$(echo "$CF_OUTPUTS" | python3 -c "import sys,json; o=json.load(sys.stdin); print(next(x['OutputValue'] for x in o if x['OutputKey']=='FrontendBucketName'))" 2>/dev/null || echo "")

echo "   UserPoolId:      $COGNITO_USER_POOL_ID"
echo "   ClientId:        $COGNITO_CLIENT_ID"
echo "   CognitoDomain:   $COGNITO_DOMAIN"
echo "   CloudFrontDomain: $CLOUDFRONT_DOMAIN"
echo "   FrontendBucket:  $FRONTEND_BUCKET"
echo "   KnowledgeBaseId: $KB_ID"
echo "Step 4 complete"

# ============================================================
# Step 5: Generate config.js
# ============================================================
echo ""
echo "Step 5: Generating frontend/public/config.js..."
cat > frontend/public/config.js << CONFIGEOF
// Auto-generated by deploy.sh -- DO NOT EDIT
window.__CONFIG__ = {
  cognitoUserPoolId: "${COGNITO_USER_POOL_ID}",
  cognitoClientId: "${COGNITO_CLIENT_ID}",
  cognitoDomain: "${COGNITO_DOMAIN}.auth.${REGION}.amazoncognito.com",
  apiBaseUrl: "",
  environment: "dev"
};
CONFIGEOF
echo "Step 5 complete"

# ============================================================
# Step 6: Build React app
# ============================================================
echo ""
echo "Step 6: Building React frontend..."
cd frontend && npm install && npm run build && cd ..
echo "Step 6 complete: output in frontend/dist/"

# ============================================================
# Step 7: Sync to S3 + invalidate CloudFront
# ============================================================
echo ""
echo "Step 7: Syncing frontend to S3 and invalidating CloudFront..."

# Hashed JS/CSS assets — long cache
aws s3 sync frontend/dist/ "s3://${FRONTEND_BUCKET}/" \
  --delete \
  --cache-control "max-age=31536000,immutable" \
  --exclude "index.html" \
  --exclude "config.js" \
  --region "$REGION"

# index.html and config.js — no cache
aws s3 sync frontend/dist/ "s3://${FRONTEND_BUCKET}/" \
  --exclude "*" \
  --include "index.html" \
  --include "config.js" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --region "$REGION"

# Invalidate CloudFront cache
DISTRIBUTION_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?contains(DomainName, '${CLOUDFRONT_DOMAIN}')].Id" \
  --output text 2>/dev/null || echo "")
if [ -n "$DISTRIBUTION_ID" ]; then
  aws cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION_ID" \
    --paths "/*" \
    --region "$REGION"
  echo "   CloudFront invalidation created for $DISTRIBUTION_ID"
fi

echo "Step 7 complete"

# ============================================================
# Step 8: Force-cycle ECS tasks to pick up new Docker image
# ============================================================
echo ""
echo "Step 8: Cycling ECS tasks to pick up new image..."
ECS_SERVICE=$(aws ecs list-services --cluster $STACK_NAME --region "$REGION" \
  --query 'serviceArns[0]' --output text 2>/dev/null || echo "")
if [ -n "$ECS_SERVICE" ] && [ "$ECS_SERVICE" != "None" ]; then
  ECS_SERVICE_NAME=$(basename "$ECS_SERVICE")
  aws ecs update-service \
    --cluster $STACK_NAME \
    --service "$ECS_SERVICE_NAME" \
    --force-new-deployment \
    --region "$REGION" \
    --query 'service.{status:status,running:runningCount,desired:desiredCount}' \
    --output json
  echo "   ECS service $ECS_SERVICE_NAME cycling — new tasks will pull latest image"
  echo "   (Tasks typically stabilise within 60-90 seconds)"
else
  echo "   No ECS service found in cluster $STACK_NAME, skipping"
fi
echo "Step 8 complete"

echo ""
echo "Deployment complete!"
echo "   App URL: https://${CLOUDFRONT_DOMAIN}"
echo "   Nova Model: $NOVA_MODEL_ID"
echo "   Reasoning Model: $REASONING_MODEL_ID"
echo "   Knowledge Base: $KB_ID"
