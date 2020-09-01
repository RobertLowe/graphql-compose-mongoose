import type { Document } from 'mongoose';

// ValidationError
export type DocumentErrors = {
  path: string;
  message: string;
  value: any;
}[];

export type ValidationError = {
  message: string;
  errors: DocumentErrors;
};

export type ManyValidationError = {
  message: string;
  errors: [ValidationError];
};

export async function validateDocument(doc: Document): Promise<ValidationError | null> {
  const validations: any = await new Promise(function (resolve) {
    doc.validate(resolve);
  });

  return Promise.resolve(
    validations && validations.errors
      ? {
          message: validations.message,
          errors: Object.keys(validations.errors).map((key) => {
            const { message, value } = validations.errors[key];
            return {
              path: key,
              message,
              value,
            };
          }),
        }
      : null
  );
}
