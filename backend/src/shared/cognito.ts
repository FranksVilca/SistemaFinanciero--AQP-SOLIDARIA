import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";

let client: CognitoIdentityProviderClient | undefined;

/** The Cognito client of the functions that ask or change the identity provider (created once per container). */
export function cognitoClient(): CognitoIdentityProviderClient {
  client ??= new CognitoIdentityProviderClient({
    region: process.env.AWS_REGION || "us-east-1",
    // Only set to point at an emulator; in AWS the SDK resolves the endpoint.
    endpoint: process.env.COGNITO_IDP_ENDPOINT,
  });
  return client;
}
