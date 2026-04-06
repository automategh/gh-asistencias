
/**
 * Configuración de Azure para autenticar contra Microsoft Graph API
 * usando flujo de credenciales de aplicación (app-only).
 */
export interface AzureConfig {
    tenantId: string
    clientId: string
    clientSecret: string
}

/**
 * Obtiene la configuración de Azure desde las variables de entorno.
 * Lanza un error si alguna variable requerida no está presente.
 */
export const getAzureConfig = (): AzureConfig => {

    const tenantId = process.env.AZURE_TENANT_ID
    const clientId = process.env.AZURE_CLIENT_ID
    const clientSecret = process.env.AZURE_CLIENT_SECRET

    if (!tenantId || !clientId || !clientSecret) {
        throw new Error("Azure configuration is missing. Please set AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET in environment variables.")
    }

    return { tenantId, clientId, clientSecret }
}