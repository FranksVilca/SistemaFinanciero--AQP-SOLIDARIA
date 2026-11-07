<#
.SYNOPSIS
  Empties the S3 buckets of a stage and deletes its CloudFormation stack.

.DESCRIPTION
  A bucket that still contains objects (or object versions) blocks `sam delete`. This script empties the
  frontend bucket and the CloudTrail log bucket first, then runs `sam delete`.
  It refuses to run against the production stage unless -Force is passed.

.EXAMPLE
  ./scripts/cleanup.ps1 -Stage academic
#>
[CmdletBinding()]
param(
  [ValidateSet("academic", "production")]
  [string]$Stage = "academic",
  [string]$StackName = "aqp-solidaria-$Stage",
  [string]$Region = "us-east-1",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

if ($Stage -eq "production" -and -not $Force) {
  throw "Refusing to delete the production stack. Re-run with -Force if you are sure."
}

$accountId = aws sts get-caller-identity --query Account --output text
$buckets = @(
  "aqp-solidaria-spa-$Stage-$accountId",
  "aqp-solidaria-trail-$Stage-$accountId"
)

function Clear-Bucket([string]$Bucket) {
  aws s3api head-bucket --bucket $Bucket --region $Region 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Bucket $Bucket does not exist, skipping."
    return
  }
  Write-Host "Emptying $Bucket ..."
  aws s3 rm "s3://$Bucket" --recursive --region $Region | Out-Null

  # Remove object versions and delete markers in case versioning was ever enabled.
  $versions = aws s3api list-object-versions --bucket $Bucket --region $Region --output json | ConvertFrom-Json
  $objects = @($versions.Versions) + @($versions.DeleteMarkers) | Where-Object { $_ }
  foreach ($object in $objects) {
    aws s3api delete-object --bucket $Bucket --key $object.Key --version-id $object.VersionId --region $Region | Out-Null
  }
}

foreach ($bucket in $buckets) { Clear-Bucket $bucket }

Write-Host "Deleting stack $StackName ..."
sam delete --stack-name $StackName --region $Region --no-prompts
