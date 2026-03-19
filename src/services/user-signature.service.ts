import { storage } from "@/services/firebase"
import { getDownloadURL, ref as storageRef, uploadString } from "firebase/storage"

interface PersistUserSignatureOptions {
  uid: string
  signature: string | null
}

/**
 * Persiste la firma manuscrita de un usuario en Firebase Storage y devuelve la URL pública.
 *
 * Reglas:
 * - `signature === null`  -> limpia la firma y devuelve `null`.
 * - Data URL ("data:...") -> sube el archivo a `signatures/{uid}.png` y devuelve la URL de descarga.
 * - URL http/https        -> la devuelve tal cual, sin volver a subir.
 *
 * Si Firebase Storage no está inicializado, registra un error en consola y devuelve la firma sin cambios
 * para no romper el flujo de guardado del perfil.
 */
export async function persistUserSignature(options: PersistUserSignatureOptions): Promise<string | null> {
  const { uid, signature } = options

  if (signature === null) {
    return null
  }

  if (signature.startsWith("http://") || signature.startsWith("https://")) {
    return signature
  }

  if (!signature.startsWith("data:")) {
    return signature
  }

  if (!storage) {
    console.error("Firebase Storage no está inicializado; no se puede guardar la firma correctamente.")
    return signature
  }

  const path = `signatures/${uid}.png`
  const fileRef = storageRef(storage, path)

  await uploadString(fileRef, signature, "data_url")
  const downloadUrl = await getDownloadURL(fileRef)

  return downloadUrl
}
