export interface ApiErrorBody {
  error: string;
  field?: string;
}

export async function parseErrorBody(response: Response): Promise<ApiErrorBody> {
  try {
    return await response.json<ApiErrorBody>();
  } catch {
    return { error: "Coś poszło nie tak. Spróbuj ponownie." };
  }
}
