declare global {
  interface Window {
    __CONFIG__: {
      cognitoUserPoolId: string;
      cognitoClientId: string;
      cognitoDomain: string;
      apiBaseUrl: string;
      environment: string;
    };
  }
}

const config = window.__CONFIG__ ?? {
  cognitoUserPoolId: '',
  cognitoClientId: '',
  cognitoDomain: '',
  apiBaseUrl: '',
  environment: 'dev',
};

export default config;
