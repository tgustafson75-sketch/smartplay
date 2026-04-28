export interface Course {
  id: string; // golfcourseapi course_id as string
  club_name: string;
  course_name: string;
  location: { city: string; state: string; country: string };
  tees: TeeBox[];
  cached_at: number; // unix ms
}

export interface TeeBox {
  tee_name: string; // e.g. "Blue", "White", "Red"
  total_yards: number;
  course_rating: number | null;
  slope_rating: number | null;
  par_total: number;
  holes: Hole[];
}

export interface Hole {
  hole_number: number;
  par: number;
  yardage: number;
  handicap: number | null;
  gps: { lat: number; lng: number } | null;
  hazards: string[];
}
