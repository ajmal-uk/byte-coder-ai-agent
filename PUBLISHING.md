# Publishing to VS Code Marketplace

To publish **Byte Coder Ai Agent** to the official VS Code Marketplace so anyone can download it, follow these steps.

## Prerequisites

1.  **Microsoft Account**: You need a Microsoft account.
2.  **Azure DevOps Organization**: Required to create a Personal Access Token (PAT).

## Step 1: Create a Publisher

1.  Go to the [Visual Studio Marketplace Publisher Management](https://marketplace.visualstudio.com/manage).
2.  Log in with your Microsoft account.
3.  Click **Create publisher**.
4.  **Name**: `uthakkan` (This MUST match the `publisher` in your `package.json`).
5.  **ID**: `uthakkan`.
6.  Complete the verification steps.

## Step 2: Generate a Personal Access Token (PAT)

1.  Go to [Azure DevOps](https://dev.azure.com/).
2.  Go to **User Settings** (icon next to your profile) > **Personal access tokens**.
3.  Click **New Token**.
4.  **Name**: `VS Code Publish`.
5.  **Organization**: Select "All accessible organizations".
6.  **Scopes**: select **Custom defined**.
    - Click **Show all scopes**.
    - Find **Marketplace** and check **Manage**.
7.  Click **Create**.
8.  **COPY THE TOKEN**. You won't see it again.

## Step 3: Login via Command Line

Open your terminal in VS Code and run:

```bash
npx @vscode/vsce login uthakkan
```

It will ask for your **Personal Access Token**. Paste the token you copied in Step 2.

## Step 4: Publish

Once logged in, run:

```bash
npx @vscode/vsce publish
```

This will upload the version specified in `package.json` to the Marketplace! It usually takes a few minutes to verify.
