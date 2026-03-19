export interface ShortenResponse {
  shortUrl: string;
  slug: string;
  createdAt: string;
}

export interface URLRecord {
  slug: string;
  shortUrl: string;
  longUrl: string;
  createdAt: string;
}
