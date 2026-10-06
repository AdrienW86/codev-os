export type DeleteFormState = { message?: string };
export type DeleteServerAction = (previousState: DeleteFormState, formData: FormData) => Promise<DeleteFormState>;